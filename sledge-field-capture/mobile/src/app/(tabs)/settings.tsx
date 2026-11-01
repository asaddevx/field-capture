import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { AppText, Button, Card, ChipGroup, SectionHeader } from '@/components/ui';
import { LATENCY_OPTIONS } from '@/domain/settings';
import { storageUsage } from '@/services/media';
import { useAppStore } from '@/state/appStore';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { formatBytes } from '@/utils/format';

type Probe = { state: 'idle' | 'checking' | 'ok' | 'fail'; message?: string };

export default function SettingsScreen() {
  const theme = useTheme();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const total = useAppStore((s) => s.counts.total);
  const [url, setUrl] = useState(settings.apiUrl);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const [usage, setUsage] = useState(() => storageUsage());

  useFocusEffect(
    useCallback(() => {
      setUsage(storageUsage());
    }, []),
  );

  const trimmedUrl = url.trim().replace(/\/+$/, '');
  const urlChanged = trimmedUrl !== settings.apiUrl;

  const testConnection = async () => {
    setProbe({ state: 'checking' });
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${trimmedUrl}/health`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProbe({ state: 'ok', message: `Reachable · ${Date.now() - started} ms` });
    } catch (e) {
      setProbe({ state: 'fail', message: controller.signal.aborted ? 'Timed out' : e instanceof Error ? e.message : 'Failed' });
    } finally {
      clearTimeout(timer);
    }
  };

  const probeColor = probe.state === 'ok' ? theme.status.synced : probe.state === 'fail' ? theme.status.error : theme.textMuted;

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Sync server" />
        <Card style={{ gap: space.md }}>
          <TextInput
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setProbe({ state: 'idle' });
            }}
            placeholder="https://your-worker.workers.dev"
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
          />
          {probe.state !== 'idle' && probe.state !== 'checking' && (
            <View style={styles.probe}>
              <MaterialCommunityIcons
                name={probe.state === 'ok' ? 'check-circle' : 'close-circle'}
                size={16}
                color={probeColor}
              />
              <AppText variant="caption" color={probeColor}>
                {probe.message}
              </AppText>
            </View>
          )}
          <View style={styles.row}>
            <Button
              label="Test"
              icon="lan-connect"
              variant="secondary"
              compact
              loading={probe.state === 'checking'}
              disabled={!trimmedUrl}
              onPress={testConnection}
              style={{ flex: 1 }}
            />
            <Button
              label="Save"
              icon="content-save-outline"
              compact
              disabled={!urlChanged || !trimmedUrl}
              onPress={() => void updateSettings({ apiUrl: trimmedUrl })}
              style={{ flex: 1 }}
            />
          </View>
        </Card>

        <SectionHeader title="Developer tools" />
        <Card style={{ gap: space.lg }}>
          <View style={[styles.devNote, { backgroundColor: alpha(theme.status.pending, 0.1) }]}>
            <MaterialCommunityIcons name="flask-outline" size={16} color={theme.status.pending} />
            <AppText variant="caption" muted style={{ flex: 1 }}>
              For demos and testing: these ask the server to misbehave so failure handling can be seen.
            </AppText>
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="callout">Simulate server failure</AppText>
              <AppText variant="caption" muted>
                Server answers 503 to every upload
              </AppText>
            </View>
            <Switch
              value={settings.simulateFailure}
              onValueChange={(v) => void updateSettings({ simulateFailure: v })}
              trackColor={{ true: theme.status.error, false: theme.border }}
              thumbColor="#fff"
            />
          </View>
          <View style={{ gap: space.sm }}>
            <View>
              <AppText variant="callout">Simulated latency</AppText>
              <AppText variant="caption" muted>
                Slows each request so the Syncing state is visible
              </AppText>
            </View>
            <ChipGroup
              options={LATENCY_OPTIONS.map((ms) => ({ value: String(ms), label: ms === 0 ? 'Off' : `${ms / 1000}s` }))}
              value={String(settings.simulatedLatencyMs)}
              onChange={(v) => void updateSettings({ simulatedLatencyMs: Number(v) })}
            />
          </View>
        </Card>

        <SectionHeader title="On this device" />
        <Card style={{ gap: space.md }}>
          <InfoRow label="Reports" value={String(total)} />
          <InfoRow label="Media files" value={`${usage.files} · ${formatBytes(usage.bytes)}`} />
          <InfoRow label="Storage" value="SQLite (WAL) + app documents" />
          <InfoRow label="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText muted>{label}</AppText>
      <AppText variant="callout">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  input: { height: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontSize: 15 },
  probe: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', gap: space.sm },
  devNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
