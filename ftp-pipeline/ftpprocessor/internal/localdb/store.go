package localdb

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ftpprocessor/internal/model"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type LocalTelemetryRecord struct {
	LocalID int64
	Record  model.TelemetryRecord
}

func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("ruta SQLite vacia")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) SaveTelemetryBatch(sourceFile string, records []model.TelemetryRecord) ([]int64, error) {
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
			rec.IDSerial,
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
			rec.IDSerial,
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
			 SET sync_status = 'pending', attempts = attempts + 1, last_error = ?
			 WHERE local_id = ?`,
			errText,
			id,
		)
	}
}

func (s *Store) PendingTelemetry(limit int) ([]LocalTelemetryRecord, error) {
	rows, err := s.db.Query(
		`SELECT local_id, id_serial, fecha, hora, data
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
		var item LocalTelemetryRecord
		if err := rows.Scan(
			&item.LocalID,
			&item.Record.IDSerial,
			&item.Record.Fecha,
			&item.Record.Hora,
			&item.Record.Data,
		); err != nil {
			return nil, err
		}
		records = append(records, item)
	}
	return records, rows.Err()
}

func (s *Store) Stats() int {
	var pending int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM telemetry_records WHERE sync_status = 'pending'").Scan(&pending)
	return pending
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
`)
	return err
}
