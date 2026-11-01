import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useAppStore } from '@/state/appStore';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Spinner } from './StatusBadge';
import { AppText } from './ui';

const NETWORK_LABELS: Record<string, string> = {
  WIFI: 'Wi-Fi',
  CELLULAR: 'Mobile data',
  ETHERNET: 'Ethernet',
  VPN: 'VPN',
};

export function ConnectivityBanner() {
  const theme = useTheme();
  const network = useAppStore((s) => s.network);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const queued = useAppStore((s) => s.counts.pending + s.counts.error + s.counts.syncing);

  if (!network.known) return null;

  const online = network.isOnline;
  const color = online ? theme.online : theme.status.pending;
  const title = online ? `Online${network.type && NETWORK_LABELS[network.type] ? ` · ${NETWORK_LABELS[network.type]}` : ''}` : 'Offline mode';
  const subtitle = online
    ? isSyncing
      ? 'Uploading reports…'
      : queued > 0
        ? `${queued} report${queued === 1 ? '' : 's'} waiting to upload`
        : 'Everything is synced'
    : queued > 0
      ? `${queued} report${queued === 1 ? '' : 's'} saved on this device. They'll upload when you reconnect.`
      : "Keep capturing. Reports are saved on this device and upload when you're back online.";

  return (
    <Animated.View
      key={online ? 'online' : 'offline'}
      entering={FadeIn.duration(250)}
      style={[styles.banner, { backgroundColor: alpha(color, theme.dark ? 0.12 : 0.1), borderColor: alpha(color, 0.35) }]}>
      <View style={[styles.iconWrap, { backgroundColor: alpha(color, 0.18) }]}>
        {online && isSyncing ? (
          <Spinner spinning>
            <MaterialCommunityIcons name="sync" size={20} color={color} />
          </Spinner>
        ) : (
          <MaterialCommunityIcons name={online ? 'wifi' : 'wifi-off'} size={20} color={color} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="callout" color={color}>
          {title}
        </AppText>
        <AppText variant="caption" muted>
          {subtitle}
        </AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
