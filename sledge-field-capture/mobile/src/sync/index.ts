import { sqliteSyncStore } from '@/db/reportRepository';
import { useAppStore } from '@/state/appStore';

import { createHttpTransport } from './httpTransport';
import { SyncEngine } from './syncEngine';

/** The app-wide engine, wired to SQLite, HTTP and the live network state. */
export const syncEngine = new SyncEngine({
  store: sqliteSyncStore,
  transport: createHttpTransport(() => useAppStore.getState().settings),
  isOnline: () => useAppStore.getState().network.isOnline,
  onRunStateChange: (running) => useAppStore.setState({ isSyncing: running }),
});
