export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type Category = 'safety' | 'defect' | 'progress' | 'inspection';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type AttachmentKind = 'photo' | 'audio';

export interface Attachment {
  id: string;
  reportId: string;
  kind: AttachmentKind;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** True once the server has acknowledged this file; lets a retry skip it. */
  uploaded: boolean;
  createdAt: number;
}

export interface Report {
  id: string;
  title: string;
  description: string;
  category: Category;
  severity: Severity;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  createdAt: number;
  updatedAt: number;
  syncStatus: SyncStatus;
  /** Consecutive failed attempts; drives backoff. Reset on success or manual retry. */
  attempts: number;
  lastError: string | null;
  /** False for failures that retrying cannot fix (e.g. validation); those wait for the user. */
  errorRetryable: boolean;
  nextAttemptAt: number | null;
  syncedAt: number | null;
  deliveryCount: number | null;
}

export interface ReportWithAttachments extends Report {
  attachments: Attachment[];
}

export interface ReportListItem extends Report {
  photoCount: number;
  audioCount: number;
  coverUri: string | null;
}

export type SyncEventType =
  | 'created'
  | 'sync_started'
  | 'attachment_uploaded'
  | 'synced'
  | 'failed'
  | 'retry_requested'
  | 'recovered';

export interface SyncEvent {
  id: number;
  reportId: string;
  type: SyncEventType;
  message: string | null;
  at: number;
}

export interface NewAttachment {
  id: string;
  kind: AttachmentKind;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface NewReport {
  title: string;
  description: string;
  category: Category;
  severity: Severity;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  attachments: NewAttachment[];
}

export interface StatusCounts {
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  error: number;
}
