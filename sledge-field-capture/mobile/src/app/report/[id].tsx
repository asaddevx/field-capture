import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AudioClip } from '@/components/AudioClip';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, Button, Card, EmptyState, SectionHeader, type IconName } from '@/components/ui';
import { subscribeToDataChanges } from '@/db/database';
import { reportRepository } from '@/db/reportRepository';
import { categoryMeta, SEVERITIES } from '@/domain/constants';
import type { Attachment, ReportWithAttachments, SyncEvent, SyncEventType } from '@/domain/types';
import { deleteReport, retryReport } from '@/services/reports';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { formatCoords, formatCountdown, formatDateTime, formatTime } from '@/utils/format';
import { useNow } from '@/utils/useNow';

const EVENT_META: Record<SyncEventType, { icon: IconName; label: string }> = {
  created: { icon: 'content-save-outline', label: 'Saved on device' },
  sync_started: { icon: 'cloud-upload-outline', label: 'Upload started' },
  attachment_uploaded: { icon: 'paperclip', label: 'Attachment uploaded' },
  synced: { icon: 'check-circle-outline', label: 'Synced to server' },
  failed: { icon: 'alert-circle-outline', label: 'Upload failed' },
  retry_requested: { icon: 'refresh', label: 'Retry requested' },
  recovered: { icon: 'restore', label: 'Recovered after restart' },
};

/** Live view of one report: reloads whenever the database changes. */
function useReportDetail(id: string) {
  const [report, setReport] = useState<ReportWithAttachments | null | undefined>(undefined);
  const [events, setEvents] = useState<SyncEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [r, e] = await Promise.all([reportRepository.get(id), reportRepository.events(id)]);
      if (!cancelled) {
        setReport(r);
        setEvents(e);
      }
    };
    void load();
    const unsubscribe = subscribeToDataChanges(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  return { report, events };
}

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { report, events } = useReportDetail(id);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const now = useNow(report?.syncStatus === 'error' && report.nextAttemptAt !== null);

  if (report === undefined) return null;
  if (report === null) {
    return <EmptyState icon="file-question-outline" title="Report not found" message="It may have been deleted." />;
  }

  const photos = report.attachments.filter((a) => a.kind === 'photo');
  const voiceNote = report.attachments.find((a) => a.kind === 'audio');
  const category = categoryMeta(report.category);
  const severityColor = theme.severity[report.severity];
  const severityLabel = SEVERITIES.find((s) => s.value === report.severity)?.label ?? report.severity;
  const uploadedCount = report.attachments.filter((a) => a.uploaded).length;

  const onDelete = () => {
    Alert.alert(
      'Delete report?',
      report.syncStatus === 'synced'
        ? 'This removes it from this device. The copy on the server is kept.'
        : 'This report has not been uploaded yet. Deleting it will lose it permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteReport(report.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: category.label }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}>
        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
            {photos.map((photo, index) => (
              <Pressable key={photo.id} onPress={() => setViewerIndex(index)} accessibilityLabel={`Open photo ${index + 1}`}>
                <Image
                  source={{ uri: photo.localUri }}
                  style={[styles.galleryImage, photos.length === 1 && styles.galleryImageSingle, { backgroundColor: theme.surfaceAlt }]}
                  contentFit="cover"
                  transition={200}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={{ gap: space.sm }}>
          <View style={styles.tags}>
            <StatusBadge status={report.syncStatus} />
            <View style={[styles.tag, { backgroundColor: alpha(severityColor, 0.12), borderColor: alpha(severityColor, 0.35) }]}>
              <View style={[styles.dot, { backgroundColor: severityColor }]} />
              <AppText variant="caption" color={severityColor} style={{ fontWeight: '700' }}>
                {severityLabel}
              </AppText>
            </View>
          </View>
          <AppText variant="title">{report.title}</AppText>
          {report.description ? <AppText style={{ lineHeight: 22 }}>{report.description}</AppText> : null}
        </View>

        {voiceNote && <AudioClip uri={voiceNote.localUri} durationMs={voiceNote.durationMs} />}

        <Card style={{ gap: space.md }}>
          <MetaRow icon="clock-outline" label="Captured" value={formatDateTime(report.createdAt)} />
          <MetaRow
            icon="map-marker-outline"
            label="Location"
            value={
              report.latitude !== null && report.longitude !== null
                ? `${formatCoords(report.latitude, report.longitude)}${report.locationAccuracy ? ` (±${Math.round(report.locationAccuracy)} m)` : ''}`
                : 'Not attached'
            }
          />
          <MetaRow icon="paperclip" label="Attachments" value={`${photos.length} photo${photos.length === 1 ? '' : 's'}${voiceNote ? ' · 1 voice note' : ''}`} />
        </Card>

        <SectionHeader title="Sync" />
        <Card style={{ gap: space.md }}>
          {report.syncStatus === 'error' && (
            <View style={[styles.errorBox, { backgroundColor: alpha(theme.status.error, 0.08), borderColor: alpha(theme.status.error, 0.3) }]}>
              <MaterialCommunityIcons name="alert-circle" size={18} color={theme.status.error} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="callout" color={theme.status.error}>
                  {report.lastError ?? 'Upload failed'}
                </AppText>
                <AppText variant="caption" muted>
                  {report.errorRetryable
                    ? report.nextAttemptAt
                      ? `Attempt ${report.attempts} · retrying automatically ${formatCountdown(report.nextAttemptAt, now)}, or as soon as connectivity returns`
                      : `Attempt ${report.attempts}`
                    : 'This error will not fix itself, so automatic retry is paused.'}
                </AppText>
              </View>
            </View>
          )}
          <MetaRow icon="identifier" label="Report ID" value={report.id.slice(0, 8)} />
          {report.attachments.length > 0 && (
            <MetaRow icon="cloud-check-outline" label="Files on server" value={`${uploadedCount} of ${report.attachments.length}`} />
          )}
          {report.syncedAt && <MetaRow icon="check-circle-outline" label="Synced" value={formatDateTime(report.syncedAt)} />}
          {report.syncStatus === 'error' && (
            <Button
              label="Retry now"
              icon="refresh"
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
        </Card>

        <SectionHeader title="Activity" />
        <Card>
          {events.map((event, index) => {
            const meta = EVENT_META[event.type];
            const color =
              event.type === 'failed' ? theme.status.error : event.type === 'synced' ? theme.status.synced : theme.textMuted;
            const last = index === events.length - 1;
            return (
              <View key={event.id} style={styles.event}>
                <View style={styles.eventRail}>
                  <View style={[styles.eventIcon, { backgroundColor: alpha(color, 0.14) }]}>
                    <MaterialCommunityIcons name={meta.icon} size={14} color={color} />
                  </View>
                  {!last && <View style={[styles.eventLine, { backgroundColor: theme.border }]} />}
                </View>
                <View style={[styles.eventBody, !last && { paddingBottom: space.md }]}>
                  <View style={styles.eventHeader}>
                    <AppText variant="callout" style={{ flex: 1 }}>
                      {meta.label}
                    </AppText>
                    <AppText variant="caption" muted style={{ fontVariant: ['tabular-nums'] }}>
                      {formatTime(event.at)}
                    </AppText>
                  </View>
                  {event.message && event.message !== meta.label && (
                    <AppText variant="caption" muted>
                      {event.message}
                    </AppText>
                  )}
                </View>
              </View>
            );
          })}
        </Card>

        <Button
          label="Delete report"
          icon="trash-can-outline"
          variant="danger"
          disabled={report.syncStatus === 'syncing'}
          onPress={onDelete}
          style={{ marginTop: space.xl }}
        />
      </ScrollView>

      <PhotoViewer photos={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
    </>
  );
}

function MetaRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metaRow}>
      <MaterialCommunityIcons name={icon} size={18} color={theme.textMuted} />
      <AppText muted style={{ width: 104 }}>
        {label}
      </AppText>
      <AppText variant="callout" style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}

function PhotoViewer({ photos, index, onClose }: { photos: Attachment[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={index !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {index !== null && (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <Image source={{ uri: item.localUri }} style={{ width, height }} contentFit="contain" />
            )}
          />
        )}
        <Pressable
          accessibilityLabel="Close photo"
          onPress={onClose}
          hitSlop={12}
          style={[styles.viewerClose, { top: insets.top + space.md }]}>
          <MaterialCommunityIcons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg },
  gallery: { gap: space.sm },
  galleryImage: { width: 260, height: 195, borderRadius: radius.lg },
  galleryImageSingle: { width: 340, height: 230 },
  tags: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 26, borderRadius: 13, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  errorBox: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  event: { flexDirection: 'row', gap: space.md },
  eventRail: { alignItems: 'center', width: 26 },
  eventIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  eventLine: { width: 2, flex: 1, marginVertical: 2 },
  eventBody: { flex: 1, paddingTop: 3, gap: 2 },
  eventHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: {
    position: 'absolute',
    right: space.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
