-- Reports are keyed by the client-generated UUID, so a retried upload
-- upserts the same row instead of creating a duplicate.
CREATE TABLE IF NOT EXISTS reports (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL,
  severity          TEXT NOT NULL,
  latitude          REAL,
  longitude         REAL,
  location_accuracy REAL,
  captured_at       TEXT NOT NULL,
  received_at       TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- How many times the client delivered this report. >1 proves retries
  -- were deduplicated rather than duplicated.
  delivery_count    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  report_id    TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('photo', 'audio')),
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  duration_ms  INTEGER,
  uploaded_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_report ON attachments (report_id);
CREATE INDEX IF NOT EXISTS idx_reports_received ON reports (received_at DESC);
