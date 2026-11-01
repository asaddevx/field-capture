import type { Attachment, ReportWithAttachments, SyncEventType } from '@/domain/types';

import type { SyncStore, SyncTransport } from '../syncEngine';

let seq = 0;

export function makeReport(overrides: Partial<ReportWithAttachments> = {}): ReportWithAttachments {
  seq++;
  const id = overrides.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    title: `Report ${seq}`,
    description: '',
    category: 'defect',
    severity: 'medium',
    latitude: null,
    longitude: null,
    locationAccuracy: null,
    createdAt: seq,
    updatedAt: seq,
    syncStatus: 'pending',
    attempts: 0,
    lastError: null,
    errorRetryable: true,
    nextAttemptAt: null,
    syncedAt: null,
    deliveryCount: null,
    attachments: [],
    ...overrides,
  };
}

export function makeAttachment(reportId: string, overrides: Partial<Attachment> = {}): Attachment {
  seq++;
  return {
    id: `att-${seq}`,
    reportId,
    kind: 'photo',
    localUri: `file:///photo-${seq}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    width: 100,
    height: 100,
    durationMs: null,
    uploaded: false,
    createdAt: seq,
    ...overrides,
  };
}

/** In-memory SyncStore mirroring the SQLite repository's semantics. */
export class MemoryStore implements SyncStore {
  reports = new Map<string, ReportWithAttachments>();
  events: { reportId: string; type: SyncEventType; message: string | null }[] = [];

  constructor(reports: ReportWithAttachments[] = []) {
    for (const r of reports) this.reports.set(r.id, structuredClone(r));
  }

  get(id: string): ReportWithAttachments {
    const r = this.reports.get(id);
    if (!r) throw new Error(`no report ${id}`);
    return r;
  }

  async recoverInterrupted() {
    let n = 0;
    for (const r of this.reports.values()) {
      if (r.syncStatus === 'syncing') {
        r.syncStatus = 'pending';
        n++;
      }
    }
    return n;
  }

  async listDue(now: number, limit: number) {
    return [...this.reports.values()]
      .filter(
        (r) =>
          r.syncStatus === 'pending' ||
          (r.syncStatus === 'error' && r.errorRetryable && r.nextAttemptAt !== null && r.nextAttemptAt <= now),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async makeRetryableDue(now: number) {
    let n = 0;
    for (const r of this.reports.values()) {
      if (r.syncStatus === 'error' && r.errorRetryable) {
        r.nextAttemptAt = now;
        n++;
      }
    }
    return n;
  }

  async markSyncing(id: string) {
    this.get(id).syncStatus = 'syncing';
  }

  async markAttachmentUploaded(attachmentId: string) {
    for (const r of this.reports.values()) {
      for (const a of r.attachments) if (a.id === attachmentId) a.uploaded = true;
    }
  }

  async resetAttachmentUploads(id: string) {
    for (const a of this.get(id).attachments) a.uploaded = false;
  }

  async markSynced(id: string, now: number, deliveryCount: number) {
    Object.assign(this.get(id), {
      syncStatus: 'synced',
      syncedAt: now,
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      deliveryCount,
    });
  }

  async markFailed(
    id: string,
    f: { message: string; retryable: boolean; attempts: number; nextAttemptAt: number | null },
  ) {
    Object.assign(this.get(id), {
      syncStatus: 'error',
      lastError: f.message,
      errorRetryable: f.retryable,
      attempts: f.attempts,
      nextAttemptAt: f.nextAttemptAt,
    });
  }

  async nextScheduledAttemptAt() {
    const times = [...this.reports.values()]
      .filter((r) => r.syncStatus === 'error' && r.errorRetryable && r.nextAttemptAt !== null)
      .map((r) => r.nextAttemptAt as number);
    return times.length ? Math.min(...times) : null;
  }

  async logEvent(reportId: string, type: SyncEventType, message: string | null) {
    this.events.push({ reportId, type, message });
  }
}

type Handler<T> = (report: ReportWithAttachments, attachment?: Attachment) => Promise<T> | T;

/** Transport whose behaviour each test scripts; records every call. */
export class FakeTransport implements SyncTransport {
  attachmentCalls: string[] = [];
  reportCalls: string[] = [];
  onAttachment: Handler<void> = () => {};
  onReport: Handler<{ deliveryCount: number }> = () => ({ deliveryCount: 1 });

  async uploadAttachment(report: ReportWithAttachments, attachment: Attachment) {
    this.attachmentCalls.push(attachment.id);
    await this.onAttachment(report, attachment);
  }

  async upsertReport(report: ReportWithAttachments) {
    this.reportCalls.push(report.id);
    return this.onReport(report);
  }
}
