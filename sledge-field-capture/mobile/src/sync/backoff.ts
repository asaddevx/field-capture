export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
  /** Fraction of the delay randomised in either direction, to avoid thundering herds. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 5_000,
  maxMs: 5 * 60_000,
  jitter: 0.2,
};

/** Exponential backoff: 5s, 10s, 20s … capped at 5 min, ±20% jitter. */
export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
  const spread = raw * policy.jitter;
  return Math.round(raw - spread + random() * spread * 2);
}
