import { AppState } from 'react-native';
import * as Network from 'expo-network';

import { getDatabase, subscribeToDataChanges } from '@/db/database';
import { reportRepository } from '@/db/reportRepository';
import { useAppStore } from '@/state/appStore';
import { syncEngine } from '@/sync';

import { draftAttachmentUris } from './draft';
import { cleanupOrphans } from './media';

/**
 * `isConnected` only means a network interface is up. On Android,
 * `isInternetReachable` additionally requires the OS to have validated real
 * internet access, so captive portals and dead Wi-Fi don't count as online.
 */
function isOnline(state: Network.NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

function applyNetworkState(state: Network.NetworkState) {
  const previous = useAppStore.getState().network;
  const online = isOnline(state);
  useAppStore.setState({ network: { known: true, isOnline: online, type: state.type ?? null } });

  if (online && (!previous.known || !previous.isOnline)) {
    void syncEngine.handleReconnect();
  }
}

let started = false;

/** One-time startup: database, settings, live data, connectivity and sync. */
export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;

  await getDatabase();
  const store = useAppStore.getState();
  await store.loadSettings();
  await store.refresh();
  subscribeToDataChanges(() => void useAppStore.getState().refresh());

  // Recover interrupted uploads before connectivity events can trigger a run.
  await syncEngine.start();

  applyNetworkState(await Network.getNetworkStateAsync());
  Network.addNetworkStateListener(applyNetworkState);

  AppState.addEventListener('change', (status) => {
    if (status === 'active') void syncEngine.requestSync('foreground');
  });

  useAppStore.setState({ ready: true });

  try {
    const referenced = await reportRepository.allAttachmentUris();
    for (const uri of await draftAttachmentUris()) referenced.add(uri);
    cleanupOrphans(referenced);
  } catch {
    // Housekeeping only; never block startup on it.
  }
}
