import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Ordered schema migrations. `PRAGMA user_version` records how many have run,
 * so each one executes exactly once per install. Append new entries; never
 * edit a shipped one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE reports (
    id                TEXT PRIMARY KEY NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    category          TEXT NOT NULL,
    severity          TEXT NOT NULL,
    latitude          REAL,
    longitude         REAL,
    location_accuracy REAL,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    sync_status       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (sync_status IN ('pending', 'syncing', 'synced', 'error')),
    attempts          INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    error_retryable   INTEGER NOT NULL DEFAULT 1,
    next_attempt_at   INTEGER,
    synced_at         INTEGER,
    delivery_count    INTEGER
  );
  CREATE INDEX idx_reports_status ON reports (sync_status, next_attempt_at);
  CREATE INDEX idx_reports_created ON reports (created_at DESC);

  CREATE TABLE attachments (
    id          TEXT PRIMARY KEY NOT NULL,
    report_id   TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('photo', 'audio')),
    local_uri   TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    duration_ms INTEGER,
    uploaded    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_attachments_report ON attachments (report_id);

  CREATE TABLE sync_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    type      TEXT NOT NULL,
    message   TEXT,
    at        INTEGER NOT NULL
  );
  CREATE INDEX idx_sync_events_report ON sync_events (report_id, at);

  CREATE TABLE kv (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= MIGRATIONS.length) return;

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (let version = current; version < MIGRATIONS.length; version++) {
      await txn.execAsync(MIGRATIONS[version]!);
    }
    await txn.execAsync(`PRAGMA user_version = ${MIGRATIONS.length}`);
  });
}
