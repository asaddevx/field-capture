import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { STATUS_LABELS } from '@/domain/constants';
import type { SyncStatus } from '@/domain/types';
import { alpha } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import type { IconName } from './ui';

export const STATUS_ICONS: Record<SyncStatus, IconName> = {
  pending: 'cloud-upload-outline',
  syncing: 'sync',
  synced: 'check-circle',
  error: 'alert-circle',
};

/** Rotates its child while `spinning` is true. */
export function Spinner({ spinning, children }: { spinning: boolean; children: React.ReactNode }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (spinning) {
      rotation.value = 0;
      rotation.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(rotation);
      rotation.value = 0;
    }
  }, [spinning, rotation]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

export function StatusBadge({ status, size = 'md' }: { status: SyncStatus; size?: 'sm' | 'md' }) {
  const theme = useTheme();
  const color = theme.status[status];
  const small = size === 'sm';

  return (
    <View
      accessibilityLabel={`Sync status: ${STATUS_LABELS[status]}`}
      style={[
        styles.badge,
        small && styles.badgeSmall,
        { backgroundColor: alpha(color, theme.dark ? 0.16 : 0.12), borderColor: alpha(color, 0.35) },
      ]}>
      <Spinner spinning={status === 'syncing'}>
        <MaterialCommunityIcons name={STATUS_ICONS[status]} size={small ? 12 : 14} color={color} />
      </Spinner>
      <Text style={[styles.label, small && styles.labelSmall, { color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeSmall: { height: 22, paddingHorizontal: 7, gap: 4 },
  label: { fontSize: 12.5, fontWeight: '700' },
  labelSmall: { fontSize: 11.5 },
});
