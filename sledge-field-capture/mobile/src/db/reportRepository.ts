import type {
  Attachment,
  Category,
  NewReport,
  Report,
  ReportListItem,
  ReportWithAttachments,
  Severity,
  StatusCounts,
  SyncEvent,
  SyncEventType,
  SyncStatus,
} from '@/domain/types';
import type { SyncStore } from '@/sync/syncEngine';

import { getDatabase, notifyDataChanged } from './database';

type ReportRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  created_at: number;
  updated_at: number;
  sync_status: string;
  attempts: number;
  last_error: string | null;
  error_retryable: number;
  next_attempt_at: number | null;
  synced_at: number | null;
  delivery_count: number | null;
};

type ListRow = ReportRow & { photo_count: number; audio_count: number; cover_uri: string | null };

type AttachmentRow = {
  id: string;
  report_id: string;
  kind: string;
  local_uri: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uploaded: number;
  created_at: number;
};

type EventRow = { id: number; report_id: string; type: string; message: string | null; at: number };

const toReport = (r: ReportRow): Report => ({
  id: r.id,
  title: r.title,
  description: r.description,
  category: r.category as Category,
  severity: r.severity as Severity,
  latitude: r.latitude,
  longitude: r.longitude,
  locationAccuracy: r.location_accuracy,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  syncStatus: r.sync_status as SyncStatus,
  attempts: r.attempts,
  lastError: r.last_error,
  errorRetryable: r.error_retryable === 1,
  nextAttemptAt: r.next_attempt_at,
  syncedAt: r.synced_at,
  deliveryCount: r.delivery_count,
});

const toAttachment = (a: AttachmentRow): Attachment => ({
  id: a.id,
  reportId: a.report_id,
  kind: a.kind as Attachment['kind'],
  localUri: a.local_uri,
  mimeType: a.mime_type,
  sizeBytes: a.size_bytes,
  width: a.width,
  height: a.height,
  durationMs: a.duration_ms,
  uploaded: a.uploaded === 1,
  createdAt: a.created_at,
});

async function attachmentsFor(reportIds: string[]): Promise<Map<string, Attachment[]>> {
  const map = new Map<string, Attachment[]>();
  if (reportIds.length === 0) return map;
  const db = await getDatabase();
  const placeholders = reportIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<AttachmentRow>(
    `SELECT * FROM attachments WHERE report_id IN (${placeholders}) ORDER BY created_at ASC`,
    reportIds,
  );
  for (const row of rows) {
    const list = map.get(row.report_id) ?? [];
    list.push(toAttachment(row));
    map.set(row.report_id, list);
  }
  return map;
}

async function insertEvent(reportId: string, type: SyncEventType, message: string | null, at: number) {
  const db = await getDatabase();
  await db.runAsync('INSERT INTO sync_events (report_id, type, message, at) VALUES (?, ?, ?, ?)', [
    reportId,
    type,
    message,
    at,
  ]);
}

export const reportRepository = {
  async create(id: string, input: NewReport, now = Date.now()): Promise<void> {
    const db = await getDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        `INSERT INTO reports (id, title, description, category, severity, latitude, longitude,
                              location_accuracy, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          id,
          input.title,
          input.description,
          input.category,
          input.severity,
          input.latitude,
          input.longitude,
          input.locationAccuracy,
          now,
          now,
        ],
      );
      for (const [index, a] of input.attachments.entries()) {
        await txn.runAsync(
          `INSERT INTO attachments (id, report_id, kind, local_uri, mime_type, size_bytes, width, height,
                                    duration_ms, uploaded, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [a.id, id, a.kind, a.localUri, a.mimeType, a.sizeBytes, a.width, a.height, a.durationMs, now + index],
        );
      }
      await txn.runAsync('INSERT INTO sync_events (report_id, type, message, at) VALUES (?, ?, ?, ?)', [
        id,
        'created',
        'Saved on device',
        now,
      ]);
    });
    notifyDataChanged();
  },

  async list(): Promise<ReportListItem[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ListRow>(
      `SELECT r.*,
              (SELECT COUNT(*) FROM attachments a WHERE a.report_id = r.id AND a.kind = 'photo') AS photo_count,
              (SELECT COUNT(*) FROM attachments a WHERE a.report_id = r.id AND a.kind = 'audio') AS audio_count,
              (SELECT a.local_uri FROM attachments a WHERE a.report_id = r.id AND a.kind = 'photo'
                 ORDER BY a.created_at ASC LIMIT 1) AS cover_uri
       FROM reports r
       ORDER BY r.created_at DESC`,
    );
    return rows.map((r) => ({
      ...toReport(r),
      photoCount: r.photo_count,
      audioCount: r.audio_count,
      coverUri: r.cover_uri,
    }));
  },

  async counts(): Promise<StatusCounts> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ sync_status: SyncStatus; n: number }>(
      'SELECT sync_status, COUNT(*) AS n FROM reports GROUP BY sync_status',
    );
    const counts: StatusCounts = { total: 0, pending: 0, syncing: 0, synced: 0, error: 0 };
    for (const row of rows) {
      counts[row.sync_status] = row.n;
      counts.total += row.n;
    }
    return counts;
  },

  async get(id: string): Promise<ReportWithAttachments | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ReportRow>('SELECT * FROM reports WHERE id = ?', [id]);
    if (!row) return null;
    const attachments = await attachmentsFor([id]);
    return { ...toReport(row), attachments: attachments.get(id) ?? [] };
  },

  async events(reportId: string): Promise<SyncEvent[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<EventRow>(
      'SELECT * FROM sync_events WHERE report_id = ? ORDER BY at ASC, id ASC',
      [reportId],
    );
    return rows.map((e) => ({
      id: e.id,
      reportId: e.report_id,
      type: e.type as SyncEventType,
      message: e.message,
      at: e.at,
    }));
  },

  /** User-initiated retry: clears backoff so the report is picked up on the next run. */
  async requeue(reportId: string, now = Date.now()): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.runAsync(
      `UPDATE reports
       SET sync_status = 'pending', attempts = 0, last_error = NULL, error_retryable = 1,
           next_attempt_at = NULL, updated_at = ?
       WHERE id = ? AND sync_status = 'error'`,
      [now, reportId],
    );
    if (result.changes > 0) {
      await insertEvent(reportId, 'retry_requested', 'Retry requested', now);
      notifyDataChanged();
    }
    return result.changes > 0;
  },

  async requeueAllFailed(now = Date.now()): Promise<number> {
    const db = await getDatabase();
    const failed = await db.getAllAsync<{ id: string }>("SELECT id FROM reports WHERE sync_status = 'error'");
    for (const { id } of failed) await this.requeue(id, now);
    return failed.length;
  },

  async delete(reportId: string): Promise<Attachment[]> {
    const db = await getDatabase();
    const attachments = (await attachmentsFor([reportId])).get(reportId) ?? [];
    await db.runAsync('DELETE FROM reports WHERE id = ?', [reportId]);
    notifyDataChanged();
    return attachments;
  },

  async allAttachmentUris(): Promise<Set<string>> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ local_uri: string }>('SELECT local_uri FROM attachments');
    return new Set(rows.map((r) => r.local_uri));
  },
};

/** SQLite implementation of the sync engine's persistence contract. */
export const sqliteSyncStore: SyncStore = {
  async recoverInterrupted(now) {
    const db = await getDatabase();
    const stuck = await db.getAllAsync<{ id: string }>("SELECT id FROM reports WHERE sync_status = 'syncing'");
    if (stuck.length === 0) return 0;
    await db.runAsync("UPDATE reports SET sync_status = 'pending', updated_at = ? WHERE sync_status = 'syncing'", [
      now,
    ]);
    for (const { id } of stuck) await insertEvent(id, 'recovered', 'Interrupted sync resumed after restart', now);
    notifyDataChanged();
    return stuck.length;
  },

  async listDue(now, limit) {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ReportRow>(
      `SELECT * FROM reports
       WHERE sync_status = 'pending'
          OR (sync_status = 'error' AND error_retryable = 1
              AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`,
      [now, limit],
    );
    const attachments = await attachmentsFor(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toReport(r), attachments: attachments.get(r.id) ?? [] }));
  },

  async makeRetryableDue(now) {
    const db = await getDatabase();
    const result = await db.runAsync(
      "UPDATE reports SET next_attempt_at = ? WHERE sync_status = 'error' AND error_retryable = 1",
      [now],
    );
    return result.changes;
  },

  async markSyncing(reportId, now) {
    const db = await getDatabase();
    await db.runAsync("UPDATE reports SET sync_status = 'syncing', updated_at = ? WHERE id = ?", [now, reportId]);
    notifyDataChanged();
  },

  async markAttachmentUploaded(attachmentId) {
    const db = await getDatabase();
    await db.runAsync('UPDATE attachments SET uploaded = 1 WHERE id = ?', [attachmentId]);
  },

  async resetAttachmentUploads(reportId) {
    const db = await getDatabase();
    await db.runAsync('UPDATE attachments SET uploaded = 0 WHERE report_id = ?', [reportId]);
  },

  async markSynced(reportId, now, deliveryCount) {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE reports
       SET sync_status = 'synced', synced_at = ?, updated_at = ?, attempts = 0, last_error = NULL,
           next_attempt_at = NULL, delivery_count = ?
       WHERE id = ?`,
      [now, now, deliveryCount, reportId],
    );
    notifyDataChanged();
  },

  async markFailed(reportId, { message, retryable, attempts, nextAttemptAt, now }) {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE reports
       SET sync_status = 'error', last_error = ?, error_retryable = ?, attempts = ?,
           next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
      [message, retryable ? 1 : 0, attempts, nextAttemptAt, now, reportId],
    );
    notifyDataChanged();
  },

  async nextScheduledAttemptAt() {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ next: number | null }>(
      "SELECT MIN(next_attempt_at) AS next FROM reports WHERE sync_status = 'error' AND error_retryable = 1",
    );
    return row?.next ?? null;
  },

  async logEvent(reportId, type, message, now) {
    await insertEvent(reportId, type, message, now);
  },
};
