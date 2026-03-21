package queue

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const (
	installationIDKey = "installation_id"
	journaldCursorKey = "journald_cursor"
)

type Event struct {
	ID      int64
	Payload string
	TS      string
}

type SQLiteQueue struct {
	db *sql.DB
}

func NewSQLiteQueue(dbPath string) (*SQLiteQueue, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`PRAGMA journal_mode = WAL;`); err != nil {
		return nil, fmt.Errorf("enable sqlite wal: %w", err)
	}

	if _, err := db.Exec(`PRAGMA busy_timeout = 5000;`); err != nil {
		return nil, fmt.Errorf("set sqlite busy timeout: %w", err)
	}

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS queued_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			payload TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS file_checkpoints (
			path TEXT PRIMARY KEY,
			offset INTEGER NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS agent_state (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`); err != nil {
		return nil, fmt.Errorf("initialize sqlite schema: %w", err)
	}

	return &SQLiteQueue{db: db}, nil
}

func (q *SQLiteQueue) Close() error {
	return q.db.Close()
}

func (q *SQLiteQueue) Count() (int64, error) {
	row := q.db.QueryRow(`SELECT COUNT(*) FROM queued_events`)

	var count int64
	if err := row.Scan(&count); err != nil {
		return 0, err
	}

	return count, nil
}

func (q *SQLiteQueue) Dequeue(batchSize int) ([]Event, error) {
	rows, err := q.db.Query(
		`SELECT id, payload, created_at FROM queued_events ORDER BY id ASC LIMIT ?`,
		batchSize,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]Event, 0, batchSize)
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.Payload, &event.TS); err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, nil
}

func (q *SQLiteQueue) Delete(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	tx, err := q.db.Begin()
	if err != nil {
		return err
	}

	stmt, err := tx.Prepare(`DELETE FROM queued_events WHERE id = ?`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()

	for _, id := range ids {
		if _, err := stmt.Exec(id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}

	return tx.Commit()
}

func (q *SQLiteQueue) EnqueueFileEvent(path string, nextOffset int64, payload []byte) error {
	tx, err := q.db.Begin()
	if err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO queued_events (payload) VALUES (?)`,
		string(payload),
	); err != nil {
		_ = tx.Rollback()
		return err
	}

	if _, err := tx.Exec(
		`
		INSERT INTO file_checkpoints (path, offset, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(path) DO UPDATE SET
			offset = excluded.offset,
			updated_at = CURRENT_TIMESTAMP
		`,
		path,
		nextOffset,
	); err != nil {
		_ = tx.Rollback()
		return err
	}

	return tx.Commit()
}

func (q *SQLiteQueue) EnqueueJournaldEvent(cursor string, payload []byte) error {
	tx, err := q.db.Begin()
	if err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO queued_events (payload) VALUES (?)`,
		string(payload),
	); err != nil {
		_ = tx.Rollback()
		return err
	}

	if _, err := tx.Exec(
		`
		INSERT INTO agent_state (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
		`,
		journaldCursorKey,
		cursor,
	); err != nil {
		_ = tx.Rollback()
		return err
	}

	return tx.Commit()
}

func (q *SQLiteQueue) GetJournaldCursor() (string, bool, error) {
	return q.GetState(journaldCursorKey)
}

func (q *SQLiteQueue) GetCheckpoint(path string) (int64, bool, error) {
	row := q.db.QueryRow(`SELECT offset FROM file_checkpoints WHERE path = ?`, path)

	var offset int64
	if err := row.Scan(&offset); err != nil {
		if err == sql.ErrNoRows {
			return 0, false, nil
		}

		return 0, false, err
	}

	return offset, true, nil
}

func (q *SQLiteQueue) GetState(key string) (string, bool, error) {
	row := q.db.QueryRow(`SELECT value FROM agent_state WHERE key = ?`, key)

	var value string
	if err := row.Scan(&value); err != nil {
		if err == sql.ErrNoRows {
			return "", false, nil
		}

		return "", false, err
	}

	return value, true, nil
}

func (q *SQLiteQueue) SetState(key, value string) error {
	_, err := q.db.Exec(
		`
		INSERT INTO agent_state (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
		`,
		key,
		value,
	)

	return err
}

func (q *SQLiteQueue) GetOrCreateInstallationID() (string, error) {
	value, exists, err := q.GetState(installationIDKey)
	if err != nil {
		return "", err
	}
	if exists {
		return value, nil
	}

	installationID := uuid.NewString()
	if err := q.SetState(installationIDKey, installationID); err != nil {
		return "", err
	}

	return installationID, nil
}
