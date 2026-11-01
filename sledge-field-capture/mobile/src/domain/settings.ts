export interface AppSettings {
  apiUrl: string;
  /** Developer toggle: asks the server to answer 503 so the error/retry path can be demonstrated. */
  simulateFailure: boolean;
  /** Developer toggle: artificial server latency so the Syncing state is visible. */
  simulatedLatencyMs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  simulateFailure: false,
  simulatedLatencyMs: 0,
};

export const LATENCY_OPTIONS = [0, 1000, 2500] as const;
