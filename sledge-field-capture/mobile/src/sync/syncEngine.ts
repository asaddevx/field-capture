import type { Attachment, ReportWithAttachments, SyncEventType } from '@/domain/types';

import { backoffDelay, DEFAULT_BACKOFF, type BackoffPolicy } from './backoff';
import { toSyncError } from './errors';

/** Persistence the engine needs. Implemented by the SQLite repository. */
export interface SyncStore {
  /** Reset rows left in `syncing` by a crash or force-quit back to `pending`. */
  recoverInterrupted(now: number): Promise<number>;
  /** Pending reports plus retryable errors whose backoff has elapsed, oldest first. */
  listDue(now: number, limit: number): Promise<ReportWithAttachments[]>;
  /** Make every retryable error due immediately (used when connectivity returns). */
  makeRetryableDue(now: number): Promise<number>;
  markSyncing(reportId: string, now: number): Promise<void>;
  markAttachmentUploaded(attachmentId: string): Promise<void>;
  resetAttachmentUploads(reportId: string): Promise<void>;
  markSynced(reportId: string, now: number, deliveryCount: number): Promise<void>;
  markFailed(
    reportId: string,
    failure: { message: string; retryable: boolean; attempts: number; nextAttemptAt: number | null; now: number },
  ): Promise<void>;
  nextScheduledAttemptAt(): Promise<number | null>;
  logEvent(reportId: string, type: SyncEventType, message: string | null, now: number): Promise<void>;
}

/** Network calls the engine needs. Both must be idempotent. */
export interface SyncTransport {
  uploadAttachment(report: ReportWithAttachments, attachment: Attachment): Promise<void>;
  upsertReport(report: ReportWithAttachments): Promise<{ deliveryCount: number }>;
}

export type SyncTrigger = 'startup' | 'created' | 'reconnect' | 'foreground' | 'manual' | 'retry' | 'backoff';

export interface SyncRunResult {
  synced: number;
  failed: number;
  skippedOffline: boolean;
}

export interface SyncEngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  isOnline: () => boolean;
  now?: () => number;
  backoff?: BackoffPolicy;
  random?: () => number;
  batchSize?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onRunStateChange?: (running: boolean) => void;
  onRunComplete?: (result: SyncRunResult, trigger: SyncTrigger) => void;
}

/**
 * Outbox-style sync engine.
 *
 * - Single-flight: concurrent triggers coalesce into the in-flight run plus at
 *   most one follow-up run, so a report is never uploaded twice in parallel.
 * - Resumable: each acknowledged attachment is recorded, so a retry only sends
 *   what the server hasn't confirmed. The server upserts by client UUID, so a
 *   repeated request (e.g. response lost mid-flight) never duplicates data.
 * - Crash-safe: `start()` returns rows stuck in `syncing` to `pending`.
 * - Backoff: retryable failures are rescheduled with exponential backoff; when
 *   connectivity returns, all retryable failures become due immediately.
 */
export class SyncEngine {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;
  private readonly backoff: BackoffPolicy;
  private readonly random: () => number;
  private readonly batchSize: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onRunStateChange?: (running: boolean) => void;
  private readonly onRunComplete?: (result: SyncRunResult, trigger: SyncTrigger) => void;

  private inFlight: Promise<SyncRunResult> | null = null;
  private rerunRequested = false;
  private timer: unknown = null;
  private stopped = false;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.isOnline = options.isOnline;
    this.now = options.now ?? Date.now;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.random = options.random ?? Math.random;
    this.batchSize = options.batchSize ?? 25;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onRunStateChange = options.onRunStateChange;
    this.onRunComplete = options.onRunComplete;
  }

  get isRunning(): boolean {
    return this.inFlight !== null;
  }

  async start(): Promise<SyncRunResult> {
    this.stopped = false;
    await this.store.recoverInterrupted(this.now());
    return this.requestSync('startup');
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer();
  }

  /** Connectivity came back: retry failures now instead of waiting out their backoff. */
  async handleReconnect(): Promise<SyncRunResult> {
    await this.store.makeRetryableDue(this.now());
    return this.requestSync('reconnect');
  }

  requestSync(trigger: SyncTrigger): Promise<SyncRunResult> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    this.cancelTimer();
    this.onRunStateChange?.(true);
    this.inFlight = this.runLoop(trigger).finally(() => {
      this.inFlight = null;
      this.onRunStateChange?.(false);
    });
    return this.inFlight;
  }

  private async runLoop(trigger: SyncTrigger): Promise<SyncRunResult> {
    const total: SyncRunResult = { synced: 0, failed: 0, skippedOffline: false };
    do {
      this.rerunRequested = false;
      const result = await this.runOnce();
      total.synced += result.synced;
      total.failed += result.failed;
      total.skippedOffline = result.skippedOffline;
    } while (this.rerunRequested && !this.stopped && this.isOnline());

    await this.scheduleNextAttempt();
    this.onRunComplete?.(total, trigger);
    return total;
  }

  private async runOnce(): Promise<SyncRunResult> {
    const result: SyncRunResult = { synced: 0, failed: 0, skippedOffline: false };
    if (!this.isOnline()) {
      result.skippedOffline = true;
      return result;
    }

    const due = await this.store.listDue(this.now(), this.batchSize);
    for (const report of due) {
      if (this.stopped) break;
      if (!this.isOnline()) {
        result.skippedOffline = true;
        break;
      }
      const outcome = await this.syncReport(report);
      if (outcome === 'synced') {
        result.synced++;
      } else {
        result.failed++;
        // The connection itself is failing: stop instead of burning every
        // report's attempt budget. Remaining reports stay pending.
        if (outcome === 'connectivity') break;
      }
    }
    return result;
  }

  private async syncReport(report: ReportWithAttachments): Promise<'synced' | 'failed' | 'connectivity'> {
    const attemptNumber = report.attempts + 1;
    await this.store.markSyncing(report.id, this.now());
    await this.store.logEvent(report.id, 'sync_started', `Attempt ${attemptNumber}`, this.now());

    try {
      for (const attachment of report.attachments) {
        if (attachment.uploaded) continue;
        await this.transport.uploadAttachment(report, attachment);
        await this.store.markAttachmentUploaded(attachment.id);
        await this.store.logEvent(report.id, 'attachment_uploaded', `${attachment.kind} uploaded`, this.now());
      }

      const { deliveryCount } = await this.transport.upsertReport(report);
      await this.store.markSynced(report.id, this.now(), deliveryCount);
      await this.store.logEvent(report.id, 'synced', null, this.now());
      return 'synced';
    } catch (raw) {
      const error = toSyncError(raw);
      if (error.kind === 'conflict') await this.store.resetAttachmentUploads(report.id);

      const now = this.now();
      const nextAttemptAt = error.retryable ? now + backoffDelay(attemptNumber, this.backoff, this.random) : null;
      await this.store.markFailed(report.id, {
        message: error.message,
        retryable: error.retryable,
        attempts: attemptNumber,
        nextAttemptAt,
        now,
      });
      await this.store.logEvent(report.id, 'failed', error.message, now);
      return error.isConnectivityFailure ? 'connectivity' : 'failed';
    }
  }

  private async scheduleNextAttempt(): Promise<void> {
    this.cancelTimer();
    if (this.stopped) return;
    const next = await this.store.nextScheduledAttemptAt();
    if (next === null) return;
    const delay = Math.min(Math.max(0, next - this.now()), this.backoff.maxMs);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.requestSync('backoff');
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
