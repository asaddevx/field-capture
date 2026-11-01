import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { ConnectivityBanner } from '@/components/ConnectivityBanner';
import { StatusBadge } from '@/components/StatusBadge';
import { Screen } from '@/components/Screen';
import { AppText, Button, Card, EmptyState, SectionHeader } from '@/components/ui';
import type { ReportListItem } from '@/domain/types';
import { retryAllFailed, retryReport, syncNow } from '@/services/reports';
import { useAppStore } from '@/state/appStore';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { formatCountdown, timeAgo } from '@/utils/format';
import { useNow } from '@/utils/useNow';

function QueueRow({ report, now }: { report: ReportListItem; now: number }) {
  const theme = useTheme();
  const [retrying, setRetrying] = useState(false);
  const isError = report.syncStatus === 'error';

  let detail: string;
  if (isError) {
    detail = report.errorRetryable
      ? report.nextAttemptAt
        ? `Attempt ${report.attempts} failed · auto-retry ${formatCountdown(report.nextAttemptAt, now)}`
        : `Attempt ${report.attempts} failed`
      : 'Will not retry automatically';
  } else if (report.syncStatus === 'synced' && report.syncedAt) {
    detail = `Uploaded ${timeAgo(report.syncedAt, now)}${report.deliveryCount && report.deliveryCount > 1 ? ` · deduplicated ×${report.deliveryCount}` : ''}`;
  } else if (report.syncStatus === 'syncing') {
    detail = 'Uploading…';
  } else {
    detail = `Captured ${timeAgo(report.createdAt, now)}`;
  }

  return (
    <Animated.View entering={FadeIn} layout={LinearTransition}>
      <Pressable
        onPress={() => router.push(`/report/${report.id}`)}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? theme.surfaceAlt : theme.surface, borderColor: theme.border },
        ]}>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.rowTop}>
            <AppText variant="callout" numberOfLines={1} style={{ flex: 1 }}>
              {report.title}
            </AppText>
            <StatusBadge status={report.syncStatus} size="sm" />
          </View>
          <AppText variant="caption" muted>
            {detail}
          </AppText>
          {isError && report.lastError && (
            <AppText variant="caption" color={theme.status.error} numberOfLines={2}>
              {report.lastError}
            </AppText>
          )}
        </View>
        {isError && (
          <Button
            label="Retry"
            icon="refresh"
            compact
            variant="secondary"
            loading={retrying}
            onPress={async () => {
              setRetrying(true);
              try {
                await retryReport(report.id);
              } finally {
                setRetrying(false);
              }
            }}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function SyncScreen() {
  const theme = useTheme();
  const reports = useAppStore((s) => s.reports);
  const counts = useAppStore((s) => s.counts);
  const isOnline = useAppStore((s) => s.network.isOnline);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);

  const failed = reports.filter((r) => r.syncStatus === 'error');
  const active = reports.filter((r) => r.syncStatus === 'syncing');
  const queued = reports.filter((r) => r.syncStatus === 'pending').reverse();
  const synced = reports.filter((r) => r.syncStatus === 'synced').slice(0, 10);
  const now = useNow(failed.length > 0 || synced.length > 0);

  const outstanding = counts.pending + counts.syncing + counts.error;

  return (
    <Screen title="Sync Center" subtitle={lastSyncedAt ? `Last sync ${timeAgo(lastSyncedAt, now)}` : 'Upload queue'}>
      <ScrollView contentContainerStyle={styles.content}>
        <ConnectivityBanner />

        <Card style={{ gap: space.md }}>
          <View style={styles.summary}>
            {(['pending', 'syncing', 'synced', 'error'] as const).map((status) => (
              <View key={status} style={styles.summaryItem}>
                <AppText variant="title" color={theme.status[status]} style={{ fontVariant: ['tabular-nums'] }}>
                  {counts[status]}
                </AppText>
                <AppText variant="caption" muted style={{ textTransform: 'capitalize' }}>
                  {status}
                </AppText>
              </View>
            ))}
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.surfaceAlt }]}>
            {counts.total > 0 &&
              (['synced', 'syncing', 'pending', 'error'] as const).map((status) =>
                counts[status] > 0 ? (
                  <View key={status} style={{ flex: counts[status], backgroundColor: theme.status[status] }} />
                ) : null,
              )}
          </View>
          <View style={styles.actions}>
            <Button
              label={isSyncing ? 'Syncing…' : 'Sync now'}
              icon="cloud-upload"
              loading={isSyncing}
              disabled={!isOnline || outstanding === 0}
              onPress={() => void syncNow()}
              style={{ flex: 1 }}
            />
            {counts.error > 0 && (
              <Button label="Retry all" icon="refresh" variant="secondary" onPress={() => void retryAllFailed()} style={{ flex: 1 }} />
            )}
          </View>
          {!isOnline && outstanding > 0 && (
            <View style={[styles.note, { backgroundColor: alpha(theme.status.pending, 0.1) }]}>
              <MaterialCommunityIcons name="information-outline" size={16} color={theme.status.pending} />
              <AppText variant="caption" muted style={{ flex: 1 }}>
                Uploads resume automatically the moment a connection is detected.
              </AppText>
            </View>
          )}
        </Card>

        {reports.length === 0 && (
          <EmptyState icon="cloud-check-outline" title="Queue is empty" message="Reports you capture appear here until they reach the server." />
        )}

        {failed.length > 0 && (
          <>
            <SectionHeader title={`Needs attention · ${failed.length}`} />
            <View style={styles.list}>
              {failed.map((r) => (
                <QueueRow key={r.id} report={r} now={now} />
              ))}
            </View>
          </>
        )}
        {active.length > 0 && (
          <>
            <SectionHeader title="Uploading" />
            <View style={styles.list}>
              {active.map((r) => (
                <QueueRow key={r.id} report={r} now={now} />
              ))}
            </View>
          </>
        )}
        {queued.length > 0 && (
          <>
            <SectionHeader title={`Queued · ${queued.length}`} />
            <View style={styles.list}>
              {queued.map((r) => (
                <QueueRow key={r.id} report={r} now={now} />
              ))}
            </View>
          </>
        )}
        {synced.length > 0 && (
          <>
            <SectionHeader title="Recently synced" />
            <View style={styles.list}>
              {synced.map((r) => (
                <QueueRow key={r.id} report={r} now={now} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md },
  summary: { flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  actions: { flexDirection: 'row', gap: space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.sm },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
