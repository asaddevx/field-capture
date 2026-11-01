import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AudioClip } from '@/components/AudioClip';
import { AppText, Button, Card, ChipGroup, SectionHeader } from '@/components/ui';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { CATEGORIES, MAX_DESCRIPTION_LENGTH, MAX_PHOTOS, MAX_TITLE_LENGTH, SEVERITIES } from '@/domain/constants';
import type { Category, NewAttachment, Severity } from '@/domain/types';
import { clearDraft, loadDraft, saveDraft } from '@/services/draft';
import { getFix, type Fix } from '@/services/location';
import { deleteQuietly, persistPhoto, persistVoiceNote } from '@/services/media';
import { createReport } from '@/services/reports';
import { useAppStore } from '@/state/appStore';
import { alpha, radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { formatCoords } from '@/utils/format';

type LocationState = { status: 'off' | 'locating' | 'found' | 'unavailable'; fix: Fix | null };

export default function NewReportScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((s) => s.network.isOnline);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('inspection');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [includeLocation, setIncludeLocation] = useState(true);
  const [attachments, setAttachments] = useState<NewAttachment[]>([]);
  const [location, setLocation] = useState<LocationState>({ status: 'locating', fix: null });
  const [processingPhotos, setProcessingPhotos] = useState(0);
  const [saving, setSaving] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const saved = useRef(false);
  // Guards against a slow GPS fix landing after the user switched location off.
  const locationEnabled = useRef(true);

  const photos = attachments.filter((a) => a.kind === 'photo');
  const voiceNote = attachments.find((a) => a.kind === 'audio');
  const titleError = title.trim().length === 0 ? 'Give the report a short title' : null;

  // Restore an unsaved draft (e.g. after the app was killed mid-capture).
  useEffect(() => {
    void loadDraft().then((draft) => {
      if (draft && (draft.title || draft.description || draft.attachments.length)) {
        setTitle(draft.title);
        setDescription(draft.description);
        setCategory(draft.category);
        setSeverity(draft.severity);
        setIncludeLocation(draft.includeLocation);
        if (!draft.includeLocation) {
          locationEnabled.current = false;
          setLocation({ status: 'off', fix: null });
        }
        setAttachments(draft.attachments);
        setRestoredDraft(true);
      }
      setDraftLoaded(true);
    });
  }, []);

  // Autosave the draft, debounced, once the stored one has been restored.
  useEffect(() => {
    if (!draftLoaded || saved.current) return;
    const id = setTimeout(() => {
      if (!saved.current) void saveDraft({ title, description, category, severity, includeLocation, attachments });
    }, 400);
    return () => clearTimeout(id);
  }, [draftLoaded, title, description, category, severity, includeLocation, attachments]);

  const requestFix = () =>
    getFix().then((fix) => {
      if (!locationEnabled.current) return;
      setLocation(fix ? { status: 'found', fix } : { status: 'unavailable', fix: null });
    });

  const locate = () => {
    setLocation({ status: 'locating', fix: null });
    void requestFix();
  };

  const toggleLocation = (enabled: boolean) => {
    locationEnabled.current = enabled;
    setIncludeLocation(enabled);
    if (enabled) locate();
    else setLocation({ status: 'off', fix: null });
  };

  useEffect(() => {
    // Initial fix only; later requests come from user actions.
    void requestFix();
  }, []);

  const addPhotos = async (source: 'camera' | 'library') => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;

    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in system settings to take photos.');
        return;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.9,
            allowsMultipleSelection: true,
            selectionLimit: remaining,
          });
    if (result.canceled) return;

    const assets = result.assets.slice(0, remaining);
    setProcessingPhotos((n) => n + assets.length);
    for (const asset of assets) {
      try {
        const photo = await persistPhoto(asset.uri, asset.width, asset.height);
        setAttachments((prev) => [...prev, photo]);
      } catch (e) {
        Alert.alert('Could not save photo', e instanceof Error ? e.message : String(e));
      } finally {
        setProcessingPhotos((n) => n - 1);
      }
    }
  };

  const removeAttachment = (attachment: NewAttachment) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    deleteQuietly(attachment.localUri);
  };

  const onVoiceRecorded = async (uri: string, durationMs: number) => {
    try {
      const note = await persistVoiceNote(uri, durationMs);
      setAttachments((prev) => [...prev.filter((a) => a.kind !== 'audio'), note]);
    } catch (e) {
      Alert.alert('Could not save voice note', e instanceof Error ? e.message : String(e));
    }
  };

  const discardDraft = () => {
    Alert.alert('Discard draft?', 'The text, photos and voice note in this draft will be deleted.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          for (const a of attachments) deleteQuietly(a.localUri);
          saved.current = true;
          void clearDraft().then(() => router.back());
        },
      },
    ]);
  };

  const save = async () => {
    if (titleError) {
      setShowErrors(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    setSaving(true);
    try {
      saved.current = true;
      const fix = includeLocation ? location.fix : null;
      await createReport({
        title: title.trim(),
        description: description.trim(),
        category,
        severity,
        latitude: fix?.latitude ?? null,
        longitude: fix?.longitude ?? null,
        locationAccuracy: fix?.accuracy ?? null,
        attachments,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      saved.current = false;
      setSaving(false);
      Alert.alert('Could not save report', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {restoredDraft && (
          <Animated.View exiting={FadeOut} style={[styles.draftBanner, { backgroundColor: alpha(theme.accent, 0.1), borderColor: alpha(theme.accent, 0.3) }]}>
            <MaterialCommunityIcons name="file-restore-outline" size={18} color={theme.accent} />
            <AppText variant="caption" style={{ flex: 1 }}>
              Restored your unsaved draft.
            </AppText>
            <Pressable onPress={discardDraft} hitSlop={8}>
              <AppText variant="callout" color={theme.accent}>
                Discard
              </AppText>
            </Pressable>
          </Animated.View>
        )}

        {!isOnline && (
          <View style={[styles.offlineHint, { backgroundColor: alpha(theme.status.pending, 0.1) }]}>
            <MaterialCommunityIcons name="wifi-off" size={16} color={theme.status.pending} />
            <AppText variant="caption" muted style={{ flex: 1 }}>
              Offline: this report will be saved on the device and uploaded automatically later.
            </AppText>
          </View>
        )}

        <SectionHeader title="Details" />
        <Card style={{ gap: space.md }}>
          <View>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title, e.g. Cracked slab, Level 2 east"
              placeholderTextColor={theme.textFaint}
              maxLength={MAX_TITLE_LENGTH}
              returnKeyType="next"
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: showErrors && titleError ? theme.danger : theme.border },
              ]}
            />
            {showErrors && titleError && (
              <AppText variant="caption" color={theme.danger} style={{ marginTop: 4 }}>
                {titleError}
              </AppText>
            )}
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What did you observe? Location on site, measurements, actions needed…"
            placeholderTextColor={theme.textFaint}
            maxLength={MAX_DESCRIPTION_LENGTH}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
          />
        </Card>

        <SectionHeader title="Category" />
        <ChipGroup options={CATEGORIES} value={category} onChange={setCategory} />

        <SectionHeader title="Severity" />
        <ChipGroup options={SEVERITIES} value={severity} onChange={setSeverity} colorFor={(v) => theme.severity[v]} />

        <SectionHeader title={`Photos · ${photos.length}/${MAX_PHOTOS}`} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
          {photos.map((photo) => (
            <Animated.View key={photo.id} entering={FadeIn} layout={LinearTransition} style={styles.photoWrap}>
              <Image source={{ uri: photo.localUri }} style={styles.photo} contentFit="cover" transition={150} />
              <Pressable
                accessibilityLabel="Remove photo"
                hitSlop={8}
                onPress={() => removeAttachment(photo)}
                style={[styles.remove, { backgroundColor: theme.overlay }]}>
                <MaterialCommunityIcons name="close" size={14} color="#fff" />
              </Pressable>
            </Animated.View>
          ))}
          {Array.from({ length: processingPhotos }, (_, i) => (
            <View key={`processing-${i}`} style={[styles.photo, styles.photoPlaceholder, { backgroundColor: theme.surfaceAlt }]}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ))}
          {photos.length + processingPhotos < MAX_PHOTOS && (
            <>
              <AddTile icon="camera" label="Camera" onPress={() => void addPhotos('camera')} />
              <AddTile icon="image-multiple" label="Gallery" onPress={() => void addPhotos('library')} />
            </>
          )}
        </ScrollView>

        <SectionHeader title="Voice note" />
        {voiceNote ? (
          <AudioClip uri={voiceNote.localUri} durationMs={voiceNote.durationMs} onRemove={() => removeAttachment(voiceNote)} />
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <VoiceRecorder onRecorded={onVoiceRecorded} />
          </View>
        )}

        <SectionHeader title="Location" />
        <Card style={styles.locationCard}>
          <View style={[styles.locationIcon, { backgroundColor: alpha(theme.accent, 0.12) }]}>
            {location.status === 'locating' ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <MaterialCommunityIcons
                name={location.status === 'found' ? 'crosshairs-gps' : 'map-marker-off-outline'}
                size={20}
                color={theme.accent}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="callout">
              {location.status === 'found' && location.fix
                ? formatCoords(location.fix.latitude, location.fix.longitude)
                : location.status === 'locating'
                  ? 'Getting GPS fix…'
                  : location.status === 'off'
                    ? 'Location not attached'
                    : 'Location unavailable'}
            </AppText>
            <AppText variant="caption" muted>
              {location.status === 'found' && location.fix?.accuracy
                ? `±${Math.round(location.fix.accuracy)} m · GPS works offline`
                : location.status === 'unavailable'
                  ? 'Permission denied or no fix yet'
                  : 'GPS works without a data connection'}
            </AppText>
          </View>
          {location.status === 'unavailable' && (
            <Pressable onPress={locate} hitSlop={8}>
              <MaterialCommunityIcons name="refresh" size={22} color={theme.accent} />
            </Pressable>
          )}
          <Switch
            value={includeLocation}
            onValueChange={toggleLocation}
            trackColor={{ true: theme.accent, false: theme.border }}
            thumbColor="#fff"
          />
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md), backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        <Button
          label={isOnline ? 'Save & upload' : 'Save offline'}
          icon={isOnline ? 'cloud-upload' : 'content-save'}
          loading={saving}
          disabled={processingPhotos > 0}
          onPress={save}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function AddTile({ icon, label, onPress }: { icon: 'camera' | 'image-multiple'; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.photo,
        styles.addTile,
        { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceAlt : theme.surface },
      ]}>
      <MaterialCommunityIcons name={icon} size={26} color={theme.accent} />
      <AppText variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const PHOTO_SIZE = 96;

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: space.sm,
  },
  offlineHint: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, marginTop: space.sm },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 15.5 },
  multiline: { minHeight: 110, paddingTop: space.md, paddingBottom: space.md, lineHeight: 21 },
  photoRow: { gap: space.sm, paddingRight: space.lg },
  photoWrap: { position: 'relative' },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: radius.md },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  locationCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  locationIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
