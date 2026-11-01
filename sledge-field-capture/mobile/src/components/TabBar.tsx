import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '@/state/appStore';
import { alpha, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import type { IconName } from './ui';

const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  index: { label: 'Home', icon: 'view-dashboard-outline', iconActive: 'view-dashboard' },
  reports: { label: 'Reports', icon: 'clipboard-text-outline', iconActive: 'clipboard-text' },
  sync: { label: 'Sync', icon: 'cloud-sync-outline', iconActive: 'cloud-sync' },
  settings: { label: 'Settings', icon: 'cog-outline', iconActive: 'cog' },
};

/** Bottom bar with a raised capture button in the centre: the app's primary action. */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const failed = useAppStore((s) => s.counts.error);
  const middle = Math.floor(state.routes.length / 2);

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}>
      {state.routes.map((route, index) => {
        const meta = TABS[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        const color = focused ? theme.accent : theme.textFaint;
        const badge = route.name === 'sync' && failed > 0 ? failed : 0;

        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            void Haptics.selectionAsync();
            navigateToTab(route.key);
          }
        };

        return (
          <Fragment key={route.key}>
            {index === middle && (
              <View style={styles.captureSlot}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New field report"
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push('/report/new');
                  }}
                  style={({ pressed }) => [
                    styles.capture,
                    {
                      backgroundColor: pressed ? theme.accentPressed : theme.accent,
                      shadowColor: theme.accent,
                      borderColor: theme.surface,
                    },
                    pressed && { transform: [{ scale: 0.94 }] },
                  ]}>
                  <MaterialCommunityIcons name="plus" size={30} color={theme.onAccent} />
                </Pressable>
              </View>
            )}
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge ? `${meta.label}, ${badge} failed` : meta.label}
              onPress={onPress}
              style={styles.tab}>
              <View>
                <MaterialCommunityIcons name={focused ? meta.iconActive : meta.icon} size={24} color={color} />
                {badge > 0 && (
                  <View style={[styles.badge, { backgroundColor: theme.status.error, borderColor: theme.surface }]}>
                    <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, { color }]}>{meta.label}</Text>
              <View style={[styles.indicator, { backgroundColor: focused ? alpha(theme.accent, 0.9) : 'transparent' }]} />
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingTop: 2 },
  label: { fontSize: 11.5, fontWeight: '600' },
  indicator: { width: 18, height: 3, borderRadius: 2, marginTop: 3 },
  captureSlot: { width: 76, alignItems: 'center' },
  capture: {
    width: 62,
    height: 62,
    borderRadius: 31,
    marginTop: -26,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
