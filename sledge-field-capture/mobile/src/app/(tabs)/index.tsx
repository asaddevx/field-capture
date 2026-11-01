import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ConnectivityBanner } from '@/components/ConnectivityBanner';
import { ReportCard } from '@/components/ReportCard';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, IconButton, SectionHeader, type IconName } from '@/components/ui';
import type { SyncStatus } from '@/domain/types';
import { syncNow } from '@/services/reports';
import { useAppStore } from '@/state/appStore';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { timeAgo } from '@/utils/format';
import { useNow } from '@/utils/useNow';

type Stat = { key: SyncStatus | 'all'; label: string; value: number; icon: IconName; color: string };

export default function DashboardScreen() {
  const theme = useTheme();
  const reports = useAppStore((s) => s.reports);
  const counts = useAppStore((s) => s.counts);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const isOnline = useAppStore((s) => s.network.isOnline);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(true, 15_000);

  const stats: Stat[] = [
    { key: 'all', label: 'Total reports', value: counts.total, icon: 'clipboard-text-multiple-outline', color: theme.accent },
    { key: 'pending', label: 'Pending', value: counts.pending + counts.syncing, icon: 'cloud-upload-outline', color: theme.status.pending },
    { key: 'synced', label: 'Synced', value: counts.synced, icon: 'check-circle-outline', color: theme.status.synced },
    { key: 'error', label: 'Failed', value: counts.error, icon: 'alert-circle-outline', color: theme.status.error },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  };

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <Screen
      title="Field Capture"
      subtitle={today}
      right={
        <IconButton
          icon="cloud-sync-outline"
          label="Sync now"
          color={isOnline ? theme.text : theme.textFaint}
          onPress={() => void syncNow()}
        />
      }>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}>
        <ConnectivityBanner />

        <View style={styles.grid}>
          {stats.map((stat, i) => (
            <Animated.View key={stat.key} entering={FadeInDown.delay(i * 50).duration(300)} style={styles.gridItem}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${stat.label}: ${stat.value}`}
                onPress={() => router.navigate({ pathname: '/reports', params: { filter: stat.key } })}
                style={({ pressed }) => [
                  styles.stat,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  pressed && { backgroundColor: theme.surfaceAlt },
                ]}>
                <View style={[styles.statIcon, { backgroundColor: alpha(stat.color, 0.14) }]}>
                  <MaterialCommunityIcons name={stat.icon} size={20} color={stat.color} />
                </View>
                <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>
                  {stat.value}
                </AppText>
                <AppText variant="caption" muted style={{ fontWeight: '600' }}>
                  {stat.label}
                </AppText>
              </Pressable>
            </Animated.View>
          ))}
        </View>

        <AppText variant="caption" muted style={styles.lastSync}>
          {isSyncing ? 'Syncing now…' : lastSyncedAt ? `Last successful sync ${timeAgo(lastSyncedAt, now)}` : 'Nothing synced yet'}
        </AppText>

        {counts.error > 0 && (
          <Card style={[styles.alert, { borderColor: alpha(theme.status.error, 0.4), backgroundColor: alpha(theme.status.error, 0.08) }]}>
            <MaterialCommunityIcons name="alert-circle" size={22} color={theme.status.error} />
            <View style={{ flex: 1 }}>
              <AppText variant="callout">
                {counts.error} report{counts.error === 1 ? '' : 's'} failed to upload
              </AppText>
              <AppText variant="caption" muted>
                They retry automatically, or you can retry now.
              </AppText>
            </View>
            <Button label="Review" compact variant="secondary" onPress={() => router.navigate('/sync')} />
          </Card>
        )}

        <SectionHeader
          title="Recent reports"
          action={
            reports.length > 0 ? (
              <Pressable hitSlop={8} onPress={() => router.navigate({ pathname: '/reports', params: { filter: 'all' } })}>
                <AppText variant="callout" color={theme.accent}>
                  See all
                </AppText>
              </Pressable>
            ) : undefined
          }
        />

        {reports.length === 0 ? (
          <Card>
            <EmptyState
              icon="hard-hat"
              title="No reports yet"
              message="Capture site conditions, defects or progress, even with no signal. Everything is saved on the device first."
              action={
                <Button label="New report" icon="plus" onPress={() => router.push('/report/new')} style={{ marginTop: space.md }} />
              }
            />
          </Card>
        ) : (
          <View style={{ gap: space.sm }}>
            {reports.slice(0, 5).map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  gridItem: { width: '50%', padding: space.xs },
  stat: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: 2 },
  statIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  lastSync: { textAlign: 'center', marginTop: -space.xs },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
