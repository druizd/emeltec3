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

const (
	dedupRetentionDays = 90
	dedupChunkSize     = 300 // SQLite limit: 999 params / 3 cols = 333 max
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
	if len(ids) == 0 {
		return
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	_, _ = s.db.Exec(
		`UPDATE telemetry_records SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE local_id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
}

func (s *Store) MarkTelemetryFailed(ids []int64, errText string) {
	if len(ids) == 0 {
		return
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, 1+len(ids))
	args[0] = errText
	for i, id := range ids {
		placeholders[i] = "?"
		args[i+1] = id
	}
	_, _ = s.db.Exec(
		`UPDATE telemetry_records SET sync_status = 'pending', attempts = attempts + 1, last_error = ? WHERE local_id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
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

// FilterDuplicates returns only records not already present in dedup_log.
// Must be called after IDSerial is assigned to all records.
// Uses row-value constructor so SQLite can use the PRIMARY KEY composite index.
func (s *Store) FilterDuplicates(records []model.TelemetryRecord) ([]model.TelemetryRecord, error) {
	if len(records) == 0 {
		return records, nil
	}
	placeholders := make([]string, len(records))
	args := make([]interface{}, len(records)*3)
	for i, r := range records {
		placeholders[i] = "(?,?,?)"
		args[i*3] = r.IDSerial
		args[i*3+1] = r.Fecha
		args[i*3+2] = r.Hora
	}
	rows, err := s.db.Query(
		`SELECT id_serial, fecha, hora FROM dedup_log WHERE (id_serial, fecha, hora) IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	already := make(map[string]struct{}, len(records))
	for rows.Next() {
		var idSerial, fecha, hora string
		if err := rows.Scan(&idSerial, &fecha, &hora); err != nil {
			return nil, err
		}
		already[idSerial+"|"+fecha+"|"+hora] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]model.TelemetryRecord, 0, len(records))
	for _, r := range records {
		if _, dup := already[r.IDSerial+"|"+r.Fecha+"|"+r.Hora]; !dup {
			out = append(out, r)
		}
	}
	return out, nil
}

// MarkDeduped inserts successfully sent records into dedup_log.
// Called only after confirmed gRPC success to preserve retry correctness.
// Uses chunked bulk INSERT to stay under SQLite's 999-parameter limit.
func (s *Store) MarkDeduped(records []model.TelemetryRecord) {
	if len(records) == 0 {
		return
	}
	for i := 0; i < len(records); i += dedupChunkSize {
		end := i + dedupChunkSize
		if end > len(records) {
			end = len(records)
		}
		chunk := records[i:end]
		placeholders := make([]string, len(chunk))
		args := make([]interface{}, len(chunk)*3)
		for j, r := range chunk {
			placeholders[j] = "(?,?,?)"
			args[j*3] = r.IDSerial
			args[j*3+1] = r.Fecha
			args[j*3+2] = r.Hora
		}
		_, _ = s.db.Exec(
			`INSERT OR IGNORE INTO dedup_log (id_serial, fecha, hora) VALUES `+
				strings.Join(placeholders, ","),
			args...,
		)
	}
}

// PurgeDedup removes dedup_log entries older than dedupRetentionDays days.
func (s *Store) PurgeDedup() {
	_, _ = s.db.Exec(
		`DELETE FROM dedup_log WHERE arrived < date('now', ?)`,
		fmt.Sprintf("-%d days", dedupRetentionDays),
	)
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -2000;

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

CREATE TABLE IF NOT EXISTS dedup_log (
	id_serial TEXT NOT NULL,
	fecha     TEXT NOT NULL,
	hora      TEXT NOT NULL,
	arrived   TEXT NOT NULL DEFAULT (date('now')),
	PRIMARY KEY (id_serial, fecha, hora)
);
`)
	return err
}
