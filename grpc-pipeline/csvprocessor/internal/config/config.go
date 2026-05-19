package config

import (
	"os"
	"strconv"
)

type Config struct {
	GRPCAddress    string
	TimeoutSeconds int

	InputDir     string
	RawBackupDir string
	FailedDir    string

	NumWorkers       int
	WatchIntervalMs  int
	RetryIntervalSec int
	StatsIntervalSec int

	MainAPIURL     string
	InternalAPIKey string
}

func Load() Config {
	return Config{
		GRPCAddress:    getEnv("GRPC_ADDRESS", "localhost:50051"),
		TimeoutSeconds: getEnvInt("TIMEOUT_SECONDS", 10),

		InputDir:     getEnv("INPUT_DIR", "data/incoming_logs"),
		RawBackupDir: getEnv("RAW_BACKUP_DIR", "data/raw_backup"),
		FailedDir:    getEnv("FAILED_DIR", "data/failed_logs"),

		NumWorkers:       getEnvInt("NUM_WORKERS", 4),
		WatchIntervalMs:  getEnvInt("WATCH_INTERVAL_MS", 200),
		RetryIntervalSec: getEnvInt("RETRY_INTERVAL_SEC", 60),
		StatsIntervalSec: getEnvInt("STATS_INTERVAL_SEC", 10),

		MainAPIURL:     getEnv("MAIN_API_URL", "http://localhost:3000"),
		InternalAPIKey: getEnv("INTERNAL_API_KEY", ""),
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
