import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { formatDuration } from '@/utils/format';

import { AppText } from './ui';

/** Compact voice-note player with progress. */
export function AudioClip({ uri, durationMs, onRemove }: { uri: string; durationMs: number | null; onRemove?: () => void }) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const total = status.duration > 0 ? status.duration * 1000 : (durationMs ?? 0);
  const progress = total > 0 ? Math.min(1, (status.currentTime * 1000) / total) : 0;

  return (
    <View style={[styles.row, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={[styles.play, { backgroundColor: theme.accent }]}>
        <MaterialCommunityIcons name={status.playing ? 'pause' : 'play'} size={22} color={theme.onAccent} />
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <AppText variant="callout">Voice note</AppText>
        <View style={[styles.track, { backgroundColor: alpha(theme.textMuted, 0.2) }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.accent }]} />
        </View>
      </View>
      <AppText variant="caption" muted style={{ fontVariant: ['tabular-nums'] }}>
        {status.playing || status.currentTime > 0 ? formatDuration(status.currentTime * 1000) : formatDuration(total)}
      </AppText>
      {onRemove && (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove voice note" hitSlop={10} onPress={onRemove}>
          <MaterialCommunityIcons name="close-circle" size={22} color={theme.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  play: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
