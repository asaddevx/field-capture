import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ReportCard } from '@/components/ReportCard';
import { Screen } from '@/components/Screen';
import { Button, ChipGroup, EmptyState } from '@/components/ui';
import type { SyncStatus } from '@/domain/types';
import { useAppStore } from '@/state/appStore';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

type Filter = SyncStatus | 'all';
const FILTERS: Filter[] = ['all', 'pending', 'syncing', 'synced', 'error'];

const isFilter = (v: unknown): v is Filter => typeof v === 'string' && (FILTERS as string[]).includes(v);

export default function ReportsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ filter?: string }>();
  const reports = useAppStore((s) => s.reports);
  const counts = useAppStore((s) => s.counts);
  const [filter, setFilter] = useState<Filter>(isFilter(params.filter) ? params.filter : 'all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  // Dashboard tiles navigate here with ?filter=…; adopt it whenever it changes.
  const [appliedParam, setAppliedParam] = useState(params.filter);
  if (params.filter !== appliedParam) {
    setAppliedParam(params.filter);
    if (isFilter(params.filter)) setFilter(params.filter);
  }

  const visible = reports.filter((r) => {
    if (filter !== 'all' && r.syncStatus !== filter) return false;
    if (!deferredQuery) return true;
    return r.title.toLowerCase().includes(deferredQuery) || r.description.toLowerCase().includes(deferredQuery);
  });

  const options = [
    { value: 'all' as const, label: 'All', count: counts.total },
    { value: 'pending' as const, label: 'Pending', count: counts.pending },
    { value: 'syncing' as const, label: 'Syncing', count: counts.syncing },
    { value: 'synced' as const, label: 'Synced', count: counts.synced },
    { value: 'error' as const, label: 'Error', count: counts.error },
  ];

  return (
    <Screen title="Reports" subtitle={`${counts.total} on this device`}>
      <View style={styles.controls}>
        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={theme.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search title or notes"
            placeholderTextColor={theme.textFaint}
            style={[styles.searchInput, { color: theme.text }]}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: space.lg }}>
          <ChipGroup
            options={options}
            value={filter}
            onChange={setFilter}
            colorFor={(v) => (v === 'all' ? theme.accent : theme.status[v])}
          />
        </ScrollView>
      </View>

      <FlashList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ReportCard report={item} />}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          reports.length === 0 ? (
            <EmptyState
              icon="clipboard-text-outline"
              title="No reports yet"
              message="Tap the + button to capture your first field report."
              action={<Button label="New report" icon="plus" onPress={() => router.push('/report/new')} />}
            />
          ) : (
            <EmptyState icon="filter-variant-remove" title="No matches" message="Try another filter or search term." />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { paddingLeft: space.lg, gap: space.md, paddingBottom: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginRight: space.lg,
    paddingHorizontal: space.md,
    height: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
});
