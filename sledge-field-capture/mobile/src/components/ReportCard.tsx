import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { categoryMeta } from '@/domain/constants';
import type { ReportListItem } from '@/domain/types';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { timeAgo } from '@/utils/format';

import { StatusBadge } from './StatusBadge';
import { AppText, type IconName } from './ui';

function ReportCardBase({ report }: { report: ReportListItem }) {
  const theme = useTheme();
  const category = categoryMeta(report.category);
  const severityColor = theme.severity[report.severity];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${report.title}, ${report.syncStatus}`}
      onPress={() => router.push(`/report/${report.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && { backgroundColor: theme.surfaceAlt },
      ]}>
      <View style={[styles.severityBar, { backgroundColor: severityColor }]} />
      {report.coverUri ? (
        <Image
          source={{ uri: report.coverUri }}
          recyclingKey={report.id}
          contentFit="cover"
          transition={150}
          style={[styles.thumb, { backgroundColor: theme.surfaceAlt }]}
        />
      ) : (
        <View style={[styles.thumb, styles.thumbIcon, { backgroundColor: alpha(theme.accent, 0.1) }]}>
          <MaterialCommunityIcons name={category.icon as IconName} size={26} color={theme.accent} />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.topRow}>
          <AppText variant="callout" numberOfLines={1} style={{ flex: 1, fontSize: 15 }}>
            {report.title}
          </AppText>
          <StatusBadge status={report.syncStatus} size="sm" />
        </View>

        <View style={styles.metaRow}>
          <AppText variant="caption" muted>
            {category.label} · {timeAgo(report.createdAt)}
          </AppText>
          {report.photoCount > 0 && (
            <View style={styles.metaItem}>
              <MaterialCommunityIcons name="image-outline" size={13} color={theme.textMuted} />
              <AppText variant="caption" muted>
                {report.photoCount}
              </AppText>
            </View>
          )}
          {report.audioCount > 0 && (
            <View style={styles.metaItem}>
              <MaterialCommunityIcons name="microphone-outline" size={13} color={theme.textMuted} />
              <AppText variant="caption" muted>
                {report.audioCount}
              </AppText>
            </View>
          )}
          {report.latitude !== null && (
            <MaterialCommunityIcons name="map-marker-outline" size={13} color={theme.textMuted} />
          )}
        </View>

        {report.syncStatus === 'error' && report.lastError && (
          <AppText variant="caption" color={theme.status.error} numberOfLines={1}>
            {report.lastError}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

export const ReportCard = memo(ReportCardBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    paddingLeft: space.md + 4,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  severityBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  thumb: { width: 58, height: 58, borderRadius: radius.md },
  thumbIcon: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
