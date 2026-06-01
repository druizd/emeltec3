package localdb

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	pb "grpc-pipeline/proto"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type LocalTelemetryRecord struct {
	LocalID  int64
	Record   *pb.TelemetryRecord
	Attempts int
}

type PLCCommand struct {
	CommandID   string `json:"command_id"`
	IDSerial    string `json:"id_serial"`
	Tag         string `json:"tag"`
	Value       string `json:"value"`
	CommandType string `json:"command_type"`
	RequestedBy string `json:"requested_by,omitempty"`
	RequestedAt string `json:"requested_at,omitempty"`
}

func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("ruta SQLite vacia")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("crear directorio SQLite: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("abrir SQLite: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) SaveTelemetryBatch(sourceFile string, records []*pb.TelemetryRecord) ([]int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	ids := make([]int64, 0, len(records))
	for _, rec := range records {
		_, err := tx.Exec(
			`INSERT OR IGNORE INTO telemetry_records (
			 id_serial, fecha, hora, data, source_file, sync_status
			 ) VALUES (?, ?, ?, ?, ?, 'pending')`,
			rec.IdSerial,
			rec.Fecha,
			rec.Hora,
			rec.Data,
			sourceFile,
		)
		if err != nil {
			return nil, err
		}

		var id int64
		err = tx.QueryRow(
			`SELECT local_id FROM telemetry_records
			 WHERE source_file = ? AND id_serial = ? AND fecha = ? AND hora = ?
			 ORDER BY local_id DESC LIMIT 1`,
			sourceFile,
			rec.IdSerial,
			rec.Fecha,
			rec.Hora,
		).Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, tx.Commit()
}

func (s *Store) MarkTelemetrySynced(ids []int64) {
	for _, id := range ids {
		_, _ = s.db.Exec(
			`UPDATE telemetry_records
			 SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP, last_error = NULL
			 WHERE local_id = ?`,
			id,
		)
	}
}

func (s *Store) MarkTelemetryFailed(ids []int64, errText string) {
	for _, id := range ids {
		_, _ = s.db.Exec(
			`UPDATE telemetry_records
			 SET sync_status = 'pending',
			     attempts = attempts + 1,
			     last_error = ?
			 WHERE local_id = ?`,
			errText,
			id,
		)
	}
}

func (s *Store) PendingTelemetry(limit int) ([]LocalTelemetryRecord, error) {
	rows, err := s.db.Query(
		`SELECT local_id, id_serial, fecha, hora, data, attempts
		 FROM telemetry_records
		 WHERE sync_status = 'pending'
		 ORDER BY created_at ASC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []LocalTelemetryRecord{}
	for rows.Next() {
		item := LocalTelemetryRecord{Record: &pb.TelemetryRecord{}}
		if err := rows.Scan(
			&item.LocalID,
			&item.Record.IdSerial,
			&item.Record.Fecha,
			&item.Record.Hora,
			&item.Record.Data,
			&item.Attempts,
		); err != nil {
			return nil, err
		}
		records = append(records, item)
	}
	return records, rows.Err()
}

func (s *Store) SavePLCCommand(cmd PLCCommand) error {
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO plc_commands (
		 command_id, id_serial, tag, value, command_type, requested_by, requested_at
		 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		cmd.CommandID,
		cmd.IDSerial,
		cmd.Tag,
		cmd.Value,
		cmd.CommandType,
		cmd.RequestedBy,
		cmd.RequestedAt,
	)
	return err
}

func (s *Store) MarkPLCCommandDone(commandID, response string) {
	_, _ = s.db.Exec(
		`UPDATE plc_commands
		 SET status = 'done', executed_at = CURRENT_TIMESTAMP, response = ?
		 WHERE command_id = ?`,
		response,
		commandID,
	)
}

func (s *Store) MarkPLCCommandFailed(commandID, errText string) {
	_, _ = s.db.Exec(
		`UPDATE plc_commands
		 SET status = 'failed', executed_at = CURRENT_TIMESTAMP, error = ?
		 WHERE command_id = ?`,
		errText,
		commandID,
	)
}

func (s *Store) MarkPLCCommandReported(commandID string) {
	_, _ = s.db.Exec(
		`UPDATE plc_commands
		 SET reported_at = CURRENT_TIMESTAMP
		 WHERE command_id = ?`,
		commandID,
	)
}

func (s *Store) Stats() (pendingTelemetry int, pendingCommands int) {
	_ = s.db.QueryRow(
		"SELECT COUNT(*) FROM telemetry_records WHERE sync_status = 'pending'",
	).Scan(&pendingTelemetry)
	_ = s.db.QueryRow(
		"SELECT COUNT(*) FROM plc_commands WHERE status IN ('pending', 'failed') AND reported_at IS NULL",
	).Scan(&pendingCommands)
	return pendingTelemetry, pendingCommands
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS telemetry_records (
	local_id INTEGER PRIMARY KEY AUTOINCREMENT,
	id_serial TEXT NOT NULL,
	fecha TEXT NOT NULL,
	hora TEXT NOT NULL,
	data TEXT NOT NULL,
	source_file TEXT,
	sync_status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	synced_at TEXT,
	UNIQUE(source_file, id_serial, fecha, hora)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_records_sync
ON telemetry_records(sync_status, created_at);

CREATE INDEX IF NOT EXISTS idx_telemetry_records_device
ON telemetry_records(id_serial, fecha, hora);

CREATE TABLE IF NOT EXISTS plc_commands (
	local_id INTEGER PRIMARY KEY AUTOINCREMENT,
	command_id TEXT NOT NULL UNIQUE,
	id_serial TEXT NOT NULL,
	tag TEXT NOT NULL,
	value TEXT NOT NULL,
	command_type TEXT NOT NULL DEFAULT 'write_tag',
	status TEXT NOT NULL DEFAULT 'pending',
	requested_by TEXT,
	requested_at TEXT,
	received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	executed_at TEXT,
	reported_at TEXT,
	error TEXT,
	response TEXT
);

CREATE INDEX IF NOT EXISTS idx_plc_commands_status
ON plc_commands(status, received_at);

CREATE INDEX IF NOT EXISTS idx_plc_commands_device
ON plc_commands(id_serial, received_at);
`)
	if err != nil {
		return fmt.Errorf("migrar SQLite local: %w", err)
	}

	_, _ = s.db.Exec(
		`UPDATE plc_commands
		 SET status = 'failed', error = ?
		 WHERE status = 'pending' AND received_at < ?`,
		"comando local pendiente vencido al iniciar",
		time.Now().Add(-24*time.Hour).Format(time.RFC3339),
	)
	return nil
}
