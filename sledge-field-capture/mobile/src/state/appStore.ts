import { create } from 'zustand';

import { kvRepository } from '@/db/kvRepository';
import { reportRepository } from '@/db/reportRepository';
import { DEFAULT_SETTINGS, type AppSettings } from '@/domain/settings';
import type { ReportListItem, StatusCounts } from '@/domain/types';

const SETTINGS_KEY = 'settings';

export interface NetworkSnapshot {
  /** False until the first network reading arrives. */
  known: boolean;
  isOnline: boolean;
  type: string | null;
}

interface AppState {
  ready: boolean;
  reports: ReportListItem[];
  counts: StatusCounts;
  lastSyncedAt: number | null;
  network: NetworkSnapshot;
  isSyncing: boolean;
  settings: AppSettings;

  refresh: () => Promise<void>;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

let refreshing = false;
let refreshAgain = false;

export const useAppStore = create<AppState>()((set, get) => ({
  ready: false,
  reports: [],
  counts: { total: 0, pending: 0, syncing: 0, synced: 0, error: 0 },
  lastSyncedAt: null,
  network: { known: false, isOnline: false, type: null },
  isSyncing: false,
  settings: DEFAULT_SETTINGS,

  /** Re-reads list data from SQLite. Bursts of change notifications coalesce into one extra pass. */
  refresh: async () => {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const reports = await reportRepository.list();
        const counts: StatusCounts = { total: reports.length, pending: 0, syncing: 0, synced: 0, error: 0 };
        let lastSyncedAt: number | null = null;
        for (const r of reports) {
          counts[r.syncStatus]++;
          if (r.syncedAt && (lastSyncedAt === null || r.syncedAt > lastSyncedAt)) lastSyncedAt = r.syncedAt;
        }
        set({ reports, counts, lastSyncedAt });
      } while (refreshAgain);
    } finally {
      refreshing = false;
    }
  },

  loadSettings: async () => {
    const stored = await kvRepository.get<Partial<AppSettings>>(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    if (!settings.apiUrl) settings.apiUrl = DEFAULT_SETTINGS.apiUrl;
    set({ settings });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await kvRepository.set(SETTINGS_KEY, settings);
  },
}));
