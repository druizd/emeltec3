package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/joho/godotenv"
	"golang.org/x/sys/windows/svc"

	"ftpprocessor/internal/config"
	"ftpprocessor/internal/filemanager"
	"ftpprocessor/internal/ftpreader"
	"ftpprocessor/internal/localdb"
	"ftpprocessor/internal/model"
	"ftpprocessor/internal/parser"
	"ftpprocessor/internal/sender"
)

var (
	totalProcessed atomic.Int64
	totalInserted  atomic.Int64
	totalFailed    atomic.Int64
	totalRetryOk   atomic.Int64
)

type ftpService struct{}

func (s *ftpService) Execute(_ []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	go startApp()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
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
		if err := svc.Run("FtpProcessor", &ftpService{}); err != nil {
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
	initLogging(exeDir)
	_ = godotenv.Load(filepath.Join(exeDir, "ftpprocessor", ".env"))
	_ = godotenv.Load(filepath.Join(exeDir, ".env"))
	cfg := config.Load().ResolvePaths(exeDir)
	if err := filemanager.EnsureDirectories(cfg.InputDir, cfg.RawBackupDir, cfg.FailedDir, cfg.HoldCorruptDir); err != nil {
		log.Fatalf("directorios: %v", err)
	}
	store, err := localdb.Open(cfg.SQLitePath)
	if err != nil {
		log.Fatalf("SQLite local [%s]: %v", cfg.SQLitePath, err)
	}
	fileChan := make(chan string, 500)
	var inProcess sync.Map
	fmt.Printf("ftpprocessor iniciado | workers: %d | watch: %dms | ready: %dms | retry: %ds | consumer: %s\n",
		cfg.NumWorkers, cfg.WatchIntervalMs, cfg.FileReadyAgeMs, cfg.RetryIntervalSec, cfg.GRPCAddress)
	for i := 0; i < cfg.NumWorkers; i++ {
		go func() {
			for filePath := range fileChan {
				processFile(filePath, cfg, store)
				inProcess.Delete(filePath)
			}
		}()
	}
	go watchAndExtractZips(cfg)
	go watchInputFiles(cfg, fileChan, &inProcess)
	go retryFailedFiles(cfg, fileChan, &inProcess)
	go retryPendingTelemetry(cfg, store)
	go printStats(cfg, store)
}

func initLogging(exeDir string) {
	logDir := filepath.Join(exeDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return
	}
	logPath := filepath.Join(logDir, "ftpprocessor.log")
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	os.Stdout = file
	os.Stderr = file
	log.SetOutput(file)
}

func watchAndExtractZips(cfg config.Config) {
	for {
		zips, err := filemanager.ListZipFiles(cfg.InputDir)
		if err == nil {
			for _, zipPath := range zips {
				base := filepath.Base(zipPath)
				n, err := filemanager.ExtractZip(zipPath, cfg.InputDir)
				if err != nil {
					log.Printf("zip extract [%s]: %v", base, err)
					continue
				}
				os.Remove(zipPath)
				fmt.Printf("zip ok | %s | extracted: %d\n", base, n)
			}
		}
		time.Sleep(time.Duration(cfg.WatchIntervalMs) * time.Millisecond)
	}
}

func watchInputFiles(cfg config.Config, fileChan chan<- string, inProcess *sync.Map) {
	for {
		files, err := filemanager.ListReadyInputFiles(cfg.InputDir, time.Duration(cfg.FileReadyAgeMs)*time.Millisecond)
		if err == nil {
			for _, filePath := range files {
				if _, exists := inProcess.LoadOrStore(filePath, true); !exists {
					fileChan <- filePath
				}
			}
		}
		time.Sleep(time.Duration(cfg.WatchIntervalMs) * time.Millisecond)
	}
}

func retryFailedFiles(cfg config.Config, fileChan chan<- string, inProcess *sync.Map) {
	for {
		time.Sleep(time.Duration(cfg.RetryIntervalSec) * time.Second)
		files, err := filemanager.ListInputFiles(cfg.FailedDir)
		if err != nil || len(files) == 0 {
			continue
		}
		for _, filePath := range files {
			if _, exists := inProcess.LoadOrStore(filePath, true); !exists {
				fileChan <- filePath
			}
		}
	}
}

func retryPendingTelemetry(cfg config.Config, store *localdb.Store) {
	if cfg.LocalSyncIntervalSec <= 0 {
		return
	}
	for {
		time.Sleep(time.Duration(cfg.LocalSyncIntervalSec) * time.Second)
		pending, err := store.PendingTelemetry(200)
		if err != nil || len(pending) == 0 {
			continue
		}
		ids := make([]int64, 0, len(pending))
		records := make([]model.TelemetryRecord, 0, len(pending))
		for _, item := range pending {
			ids = append(ids, item.LocalID)
			records = append(records, item.Record)
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.TimeoutSeconds)*time.Second)
		resp, err := sender.SendRecords(ctx, cfg.GRPCAddress, "sqlite-pending", records)
		cancel()
		if err != nil {
			store.MarkTelemetryFailed(ids, fmt.Sprintf("gRPC retry: %v", err))
			continue
		}
		if !resp.OK {
			store.MarkTelemetryFailed(ids, fmt.Sprintf("consumer retry: %s", resp.Message))
			continue
		}
		store.MarkTelemetrySynced(ids)
		totalRetryOk.Add(int64(len(records)))
		fmt.Printf("sqlite sync ok | records: %d\n", len(records))
	}
}

func printStats(cfg config.Config, store *localdb.Store) {
	for {
		time.Sleep(time.Duration(cfg.StatsIntervalSec) * time.Second)
		pending, _ := filemanager.ListInputFiles(cfg.InputDir)
		failed, _ := filemanager.ListInputFiles(cfg.FailedDir)
		fmt.Printf("stats | procesados: %d | insertados: %d | fallidos: %d | recuperados: %d | pendientes_archivo: %d | failed_files: %d | sqlite_pending: %d\n",
			totalProcessed.Load(), totalInserted.Load(), totalFailed.Load(), totalRetryOk.Load(),
			len(pending), len(failed), store.Stats())
	}
}

func processFile(filePath string, cfg config.Config, store *localdb.Store) {
	fileName := filepath.Base(filePath)
	isRetry := filemanager.IsInsideDir(cfg.FailedDir, filePath)
	idSerial, err := parser.SerialFromFilename(fileName)
	if err != nil {
		idSerial = "sin-serial"
	}
	for attempt := 1; attempt <= 3; attempt++ {
		ok, inserted, dur, errMsg := runPipeline(filePath, cfg, store)
		if ok {
			totalProcessed.Add(1)
			totalInserted.Add(int64(inserted))
			if isRetry {
				totalRetryOk.Add(1)
			}
			fmt.Printf("ok ftp (%s) %s | attempt %d/3 | records: %d | %dms\n",
				idSerial, fileName, attempt, inserted, dur.Milliseconds())
			return
		}
		if attempt < 3 {
			fmt.Printf("warn ftp (%s) %s | attempt %d/3 | %s | reintentando\n",
				idSerial, fileName, attempt, errMsg)
			time.Sleep(200 * time.Millisecond)
			continue
		}
		totalFailed.Add(1)
		fmt.Printf("fail ftp (%s) %s | attempt 3/3 | %s\n", idSerial, fileName, errMsg)
		isCorrupt := strings.HasPrefix(errMsg, "lectura:") || strings.HasPrefix(errMsg, "parse:")
		if isCorrupt {
			destPath := filepath.Join(cfg.HoldCorruptDir, fileName)
			if err := os.Rename(filePath, destPath); err != nil {
				log.Printf("mover a hold_corrupt [%s]: %v", fileName, err)
			} else {
				fmt.Printf("corrupt ftp (%s) %s | movido a hold_corrupt\n", idSerial, fileName)
			}
		} else if !isRetry {
			if err := filemanager.MoveToFailedFromRoot(filePath, cfg.InputDir, cfg.FailedDir); err != nil {
				log.Printf("mover a failed [%s]: %v", fileName, err)
			}
		}
	}
}

func runPipeline(filePath string, cfg config.Config, store *localdb.Store) (bool, int, time.Duration, string) {
	start := time.Now()
	fileName := filepath.Base(filePath)
	rows, err := ftpreader.ReadRows(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return true, 0, time.Since(start), ""
		}
		return false, 0, 0, fmt.Sprintf("lectura: %v", err)
	}
	records, err := parser.BuildTelemetryRecords(fileName, rows)
	if err != nil {
		return false, 0, 0, fmt.Sprintf("parse: %v", err)
	}
	idSerial, err := parser.SerialFromFilename(fileName)
	if err != nil {
		idSerial = "sin-serial"
	}
	idSerial = parser.ResolveSerial(idSerial, cfg.DeviceAliases)
	for i := range records {
		records[i].IDSerial = idSerial
	}
	if err := filemanager.CopyToBackupBySerial(filePath, cfg.RawBackupDir, idSerial, parser.EarliestDate(records)); err != nil {
		return false, 0, 0, fmt.Sprintf("backup: %v", err)
	}
	if len(records) == 0 {
		filemanager.DeleteFile(filePath)
		return true, 0, time.Since(start), ""
	}

	localIDs, err := store.SaveTelemetryBatch(fileName, records)
	if err != nil {
		return false, 0, 0, fmt.Sprintf("sqlite: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.TimeoutSeconds)*time.Second)
	resp, err := sender.SendRecords(ctx, cfg.GRPCAddress, fileName, records)
	cancel()
	if err != nil {
		store.MarkTelemetryFailed(localIDs, fmt.Sprintf("gRPC: %v", err))
		return false, 0, 0, fmt.Sprintf("gRPC: %v", err)
	}
	if !resp.OK {
		store.MarkTelemetryFailed(localIDs, fmt.Sprintf("consumer: %s", resp.Message))
		return false, 0, 0, fmt.Sprintf("consumer: %s", resp.Message)
	}
	store.MarkTelemetrySynced(localIDs)
	filemanager.DeleteFile(filePath)
	return true, resp.Inserted, time.Since(start), ""
}
