package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	InputDir             string
	RawBackupDir         string
	FailedDir            string
	HoldCorruptDir       string
	SQLitePath           string
	GRPCAddress          string
	NumWorkers           int
	WatchIntervalMs      int
	RetryIntervalSec     int
	LocalSyncIntervalSec int
	TimeoutSeconds       int
	StatsIntervalSec     int
	FileReadyAgeMs       int
	DeviceAliases        map[string]string
}

func Load() Config {
	return Config{
		InputDir:             getenv("INPUT_DIR", "data/incoming_ftp"),
		RawBackupDir:         getenv("RAW_BACKUP_DIR", "data/raw_backup"),
		FailedDir:            getenv("FAILED_DIR", "data/failed_ftp"),
		HoldCorruptDir:       getenv("HOLD_CORRUPT_DIR", "data/hold_corrupt"),
		SQLitePath:           getenv("SQLITE_PATH", "data/local/ftpprocessor.db"),
		GRPCAddress:          getenv("FTP_GRPC_ADDRESS", getenv("FTP_CONSUMER_URL", "localhost:50061")),
		NumWorkers:           getenvInt("NUM_WORKERS", 4),
		WatchIntervalMs:      getenvInt("WATCH_INTERVAL_MS", 500),
		RetryIntervalSec:     getenvInt("RETRY_INTERVAL_SEC", 30),
		LocalSyncIntervalSec: getenvInt("LOCAL_SYNC_INTERVAL_SEC", 30),
		TimeoutSeconds:       getenvInt("TIMEOUT_SECONDS", 20),
		StatsIntervalSec:     getenvInt("STATS_INTERVAL_SEC", 30),
		FileReadyAgeMs:       getenvInt("FILE_READY_AGE_MS", 3000),
		DeviceAliases:        parseDeviceAliases(getenv("DEVICE_ALIASES", "")),
	}
}

func parseDeviceAliases(raw string) map[string]string {
	aliases := make(map[string]string)
	for _, pair := range strings.Split(raw, ",") {
		parts := strings.SplitN(strings.TrimSpace(pair), ":", 2)
		if len(parts) == 2 {
			name := strings.ToUpper(strings.TrimSpace(parts[0]))
			id := strings.TrimSpace(parts[1])
			if name != "" && id != "" {
				aliases[name] = id
			}
		}
	}
	return aliases
}

func (c Config) ResolvePaths(baseDir string) Config {
	c.InputDir = resolvePath(baseDir, c.InputDir)
	c.RawBackupDir = resolvePath(baseDir, c.RawBackupDir)
	c.FailedDir = resolvePath(baseDir, c.FailedDir)
	c.HoldCorruptDir = resolvePath(baseDir, c.HoldCorruptDir)
	c.SQLitePath = resolvePath(baseDir, c.SQLitePath)
	return c
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func resolvePath(baseDir, value string) string {
	if filepath.IsAbs(value) {
		return value
	}
	return filepath.Join(baseDir, value)
}
