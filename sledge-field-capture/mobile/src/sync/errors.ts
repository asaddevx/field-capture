export type SyncErrorKind =
  /** No route to the server (offline, DNS, connection reset). */
  | 'network'
  | 'timeout'
  /** 5xx / 408 / 429: the server is unhealthy or busy. */
  | 'server'
  /** 409: server is missing attachments; they must be re-sent. */
  | 'conflict'
  /** Other 4xx: the request itself is wrong; retrying won't help. */
  | 'client'
  /** A problem on the device, e.g. an attachment file vanished. */
  | 'local'
  /** The app has no server URL configured yet. */
  | 'config';

const RETRYABLE: Record<SyncErrorKind, boolean> = {
  network: true,
  timeout: true,
  server: true,
  conflict: true,
  client: false,
  local: false,
  config: true,
};

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly status?: number;

  constructor(message: string, kind: SyncErrorKind, status?: number) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.status = status;
  }

  get retryable(): boolean {
    return RETRYABLE[this.kind];
  }

  /** Connection-level failures mean every other request would fail too. */
  get isConnectivityFailure(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

export function syncErrorFromStatus(status: number, serverMessage?: string): SyncError {
  const detail = serverMessage ? `: ${serverMessage}` : '';
  if (status === 409) return new SyncError(`Server is missing attachments (409)${detail}`, 'conflict', status);
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new SyncError(`Server unavailable (${status})${detail}`, 'server', status);
  }
  return new SyncError(`Server rejected the report (${status})${detail}`, 'client', status);
}

export function toSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new SyncError('Request timed out', 'timeout');
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SyncError(`Network unavailable (${message})`, 'network');
}
