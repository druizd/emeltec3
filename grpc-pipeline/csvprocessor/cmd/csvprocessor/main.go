package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/joho/godotenv"
	"golang.org/x/sys/windows/svc"

	"grpc-pipeline/csvprocessor/internal/alertclient"
	"grpc-pipeline/csvprocessor/internal/config"
	"grpc-pipeline/csvprocessor/internal/csvreader"
	"grpc-pipeline/csvprocessor/internal/filemanager"
	"grpc-pipeline/csvprocessor/internal/grpcclient"
	"grpc-pipeline/csvprocessor/internal/parser"
	"grpc-pipeline/csvprocessor/internal/sender"
	pb "grpc-pipeline/proto"
)

var (
	totalProcessed atomic.Int64
	totalInserted  atomic.Int64
	totalFailed    atomic.Int64
	totalRetryOk   atomic.Int64
)

type csvService struct{}

func (s *csvService) Execute(
	_ []string,
	r <-chan svc.ChangeRequest,
	status chan<- svc.Status,
) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	go startApp()

	status <- svc.Status{
		State:   svc.Running,
		Accepts: svc.AcceptStop | svc.AcceptShutdown,
	}

	for c := range r {
		if c.Cmd == svc.Stop || c.Cmd == svc.Shutdown {
			status <- svc.Status{State: svc.StopPending}
			return false, 0
		}
	}

	return false, 0
}

func main() {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("error detectando modo servicio: %v", err)
	}

	if isService {
		if err := svc.Run("CsvProcessor", &csvService{}); err != nil {
			log.Fatalf("servicio fallo: %v", err)
		}
		return
	}

	startApp()
	select {}
}

func startApp() {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)

	_ = godotenv.Load(filepath.Join(exeDir, "csvprocessor", ".env"))
	_ = godotenv.Load(filepath.Join(exeDir, ".env"))

	cfg := config.Load()

	err := filemanager.EnsureDirectories(
		cfg.InputDir,
		cfg.RawBackupDir,
		cfg.FailedDir,
	)
	if err != nil {
		log.Fatalf("error preparando directorios: %v", err)
	}

	conn, err := grpcclient.NewConnection(cfg.GRPCAddress)
	if err != nil {
		log.Fatalf("gRPC [%s]: %v", cfg.GRPCAddress, err)
	}
	client := pb.NewLogIngestionClient(conn)

	alerts := alertclient.New(cfg.MainAPIURL, cfg.InternalAPIKey)

	fileChan := make(chan string, 500)
	var inProcess sync.Map

	fmt.Printf(
		"🚀 csvprocessor iniciado | "+
			"👷 workers: %d | 👀 watch: %dms | 🔁 retry: %ds\n",
		cfg.NumWorkers,
		cfg.WatchIntervalMs,
		cfg.RetryIntervalSec,
	)
	fmt.Println("-----------------------------------------------------")

	for i := 0; i < cfg.NumWorkers; i++ {
		go func(workerID int) {
			for filePath := range fileChan {
				processFile(filePath, cfg, client, alerts)
				inProcess.Delete(filePath)
			}
		}(i)
	}

	go watchInputFiles(cfg, fileChan, &inProcess)
	go retryFailedFiles(cfg, fileChan, &inProcess)
	go printStats(cfg)
	go runArchiver(cfg)
}

func watchInputFiles(
	cfg config.Config,
	fileChan chan<- string,
	inProcess *sync.Map,
) {
	for {
		files, err := filemanager.ListInputFiles(cfg.InputDir)
		if err == nil {
			for _, f := range files {
				if _, exists := inProcess.LoadOrStore(f, true); !exists {
					fileChan <- f
				}
			}
		}

		time.Sleep(time.Duration(cfg.WatchIntervalMs) * time.Millisecond)
	}
}

func retryFailedFiles(
	cfg config.Config,
	fileChan chan<- string,
	inProcess *sync.Map,
) {
	for {
		time.Sleep(time.Duration(cfg.RetryIntervalSec) * time.Second)

		files, err := filemanager.ListInputFiles(cfg.FailedDir)
		if err != nil || len(files) == 0 {
			continue
		}

		fmt.Printf("🔁 reintentando %d archivo(s) de failed_logs...\n", len(files))
		for _, f := range files {
			if _, exists := inProcess.LoadOrStore(f, true); !exists {
				fileChan <- f
			}
		}
	}
}

func printStats(cfg config.Config) {
	for {
		time.Sleep(time.Duration(cfg.StatsIntervalSec) * time.Second)

		pending, _ := filemanager.ListInputFiles(cfg.InputDir)
		failed, _ := filemanager.ListInputFiles(cfg.FailedDir)

		fmt.Printf(
			"📊 stats | ✅ procesados: %d | "+
				"📥 insertados: %d | ❌ fallidos: %d | "+
				"♻️ recuperados: %d | ⏳ pendientes: %d | "+
				"🧯 failed: %d\n",
			totalProcessed.Load(),
			totalInserted.Load(),
			totalFailed.Load(),
			totalRetryOk.Load(),
			len(pending),
			len(failed),
		)
	}
}

func runArchiver(cfg config.Config) {
	for {
		fmt.Println("📦 archiver | revisando backups para comprimir...")

		if err := filemanager.RunArchiver(cfg.RawBackupDir); err != nil {
			log.Printf("❌ archiver: %v", err)
		} else {
			fmt.Println("✅ archiver | revision completada")
		}

		time.Sleep(time.Hour)
	}
}

func processFile(
	filePath string,
	cfg config.Config,
	client pb.LogIngestionClient,
	alerts *alertclient.Client,
) {
	fileName := filepath.Base(filePath)
	isRetry := filepath.Dir(filePath) == cfg.FailedDir
	maxTries := 3

	for attempt := 1; attempt <= maxTries; attempt++ {
		ok, inserted, dur, errMsg := runPipeline(filePath, cfg, client)

		if ok {
			totalProcessed.Add(1)
			totalInserted.Add(int64(inserted))

			if isRetry {
				totalRetryOk.Add(1)
				filemanager.DeleteFile(filePath)
				fmt.Printf(
					"♻️ retry ok %s | attempt %d/%d | "+
						"records: %d | %dms\n",
					fileName,
					attempt,
					maxTries,
					inserted,
					dur.Milliseconds(),
				)
			} else {
				fmt.Printf(
					"✅ log %s | attempt %d/%d | "+
						"records: %d | %dms\n",
					fileName,
					attempt,
					maxTries,
					inserted,
					dur.Milliseconds(),
				)
			}

			return
		}

		if attempt < maxTries {
			fmt.Printf(
				"⚠️ warn %s | attempt %d/%d | "+
					"%s | reintentando...\n",
				fileName,
				attempt,
				maxTries,
				errMsg,
			)
			time.Sleep(200 * time.Millisecond)
			continue
		}

		totalFailed.Add(1)
		fmt.Printf(
			"❌ fail %s | attempt %d/%d | %s\n",
			fileName,
			attempt,
			maxTries,
			errMsg,
		)

		if !isRetry {
			err := filemanager.MoveToFailed(filePath, cfg.FailedDir)
			if err != nil {
				log.Printf(
					"no se pudo mover [%s] a failed_logs: %v",
					fileName,
					err,
				)
			}
		}

		go alerts.EnviarAlerta(
			"error_archivo",
			map[string]any{
				"archivo":  fileName,
				"error":    errMsg,
				"intentos": maxTries,
				"carpeta":  "failed_logs",
			},
		)
	}
}

func runPipeline(
	filePath string,
	cfg config.Config,
	client pb.LogIngestionClient,
) (bool, int, time.Duration, string) {
	start := time.Now()
	fileName := filepath.Base(filePath)

	idSerial, err := filemanager.ExtractSerialIDFromFile(filePath)
	if err != nil {
		return false, 0, 0, fmt.Sprintf("id_serial: %v", err)
	}

	err = filemanager.CopyToBackupBySerial(
		filePath,
		cfg.RawBackupDir,
		idSerial,
	)
	if err != nil {
		return false, 0, 0, fmt.Sprintf("backup: %v", err)
	}

	rows, err := csvreader.ReadRows(filePath)
	if err != nil {
		return false, 0, 0, fmt.Sprintf("lectura: %v", err)
	}

	records, err := parser.BuildTelemetryRecords(rows)
	if err != nil {
		return false, 0, 0, fmt.Sprintf("parse: %v", err)
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		time.Duration(cfg.TimeoutSeconds)*time.Second,
	)
	resp, err := sender.SendRecords(ctx, client, fileName, records)
	cancel()

	if err != nil {
		return false, 0, 0, fmt.Sprintf("gRPC: %v", err)
	}

	if !resp.Ok {
		return false, 0, 0, fmt.Sprintf("consumer: %s", resp.Message)
	}

	filemanager.DeleteFile(filePath)
	return true, int(resp.Inserted), time.Since(start), ""
}
