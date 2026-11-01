import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { MAX_VOICE_NOTE_MS } from '@/domain/constants';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { formatDuration } from '@/utils/format';

import { AppText } from './ui';

// Mono AAC at a speech-friendly bitrate: clear voice, roughly 0.7 MB per minute.
const VOICE_PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 96_000,
};

export function VoiceRecorder({ onRecorded }: { onRecorded: (uri: string, durationMs: number) => void }) {
  const theme = useTheme();
  const recorder = useAudioRecorder(VOICE_PRESET);
  const state = useAudioRecorderState(recorder, 200);
  const stopping = useRef(false);
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = state.isRecording ? withRepeat(withTiming(0.35, { duration: 700 }), -1, true) : 1;
  }, [state.isRecording, pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const start = async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone access needed', 'Allow microphone access in system settings to record voice notes.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      const duration = state.durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (recorder.uri && duration > 500) onRecorded(recorder.uri, duration);
    } finally {
      stopping.current = false;
    }
  };

  useEffect(() => {
    if (state.isRecording && state.durationMillis >= MAX_VOICE_NOTE_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRecording, state.durationMillis]);

  if (state.isRecording) {
    return (
      <Animated.View
        entering={FadeIn}
        style={[styles.recording, { backgroundColor: alpha(theme.danger, 0.1), borderColor: alpha(theme.danger, 0.4) }]}>
        <Animated.View style={[styles.dot, { backgroundColor: theme.danger }, dotStyle]} />
        <View style={{ flex: 1 }}>
          <AppText variant="callout" color={theme.danger}>
            Recording…
          </AppText>
          <AppText variant="caption" muted>
            Max {formatDuration(MAX_VOICE_NOTE_MS)}
          </AppText>
        </View>
        <AppText variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
          {formatDuration(state.durationMillis)}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
          onPress={stop}
          style={[styles.stop, { backgroundColor: theme.danger }]}>
          <MaterialCommunityIcons name="stop" size={22} color="#fff" />
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record voice note"
      onPress={start}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && { backgroundColor: theme.surfaceAlt },
      ]}>
      <MaterialCommunityIcons name="microphone" size={24} color={theme.accent} />
      <AppText variant="caption" style={{ fontWeight: '600' }}>
        Voice note
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    height: 76,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  recording: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  stop: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
