import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { InitialsAvatar, ReadinessPill } from '@/components/coach/readiness';
import { AthleteSummary, getTeamOverview } from '@/lib/coachService';

/**
 * Coach Athletes — searchable roster with live load (AU) and readiness
 * status computed from tbl_athletes + tbl_session_metrics.
 */
export default function CoachAthletesScreen() {
  const theme = useTheme();
  const [athletes, setAthletes] = useState<AthleteSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await getTeamOverview();
      setAthletes(overview.athletes);
      setError(null);
    } catch (err: any) {
      console.warn('Error loading athletes:', err);
      setError(err?.message ?? 'Failed to load athletes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return athletes;
    return athletes.filter(
      (a) => a.fullName.toLowerCase().includes(q) || a.username.toLowerCase().includes(q)
    );
  }, [athletes, query]);

  const renderItem = ({ item }: { item: AthleteSummary }) => (
    <Surface
      style={[
        styles.row,
        { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant },
      ]}
      elevation={0}
    >
      <InitialsAvatar initials={item.initials} color={theme.colors.primaryContainer} />
      <View style={styles.rowInfo}>
        <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface }} numberOfLines={1}>
          {item.fullName}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
          {[item.username ? `@${item.username}` : null, item.gender || null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text variant="titleSmall" style={{ fontWeight: '700', color: theme.colors.onSurface }}>
          {item.lastLoadAu !== null ? `${item.lastLoadAu} AU` : '— AU'}
        </Text>
        <ReadinessPill status={item.readiness} />
      </View>
      <Icon source="chevron-right" size={22} color={theme.colors.onSurfaceVariant} />
    </Surface>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text variant="headlineLarge" style={[styles.title, { color: theme.colors.onBackground }]}>
            Athletes
          </Text>
          <View style={[styles.countBadge, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12 }}>
              {athletes.length}
            </Text>
          </View>
        </View>

        <TextInput
          mode="outlined"
          placeholder="Search athletes..."
          value={query}
          onChangeText={setQuery}
          left={<TextInput.Icon icon="magnify" />}
          style={styles.search}
          outlineStyle={{ borderRadius: 16, borderColor: theme.colors.outlineVariant }}
          dense
        />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(a) => String(a.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
              />
            }
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon source="account-group-outline" size={56} color={theme.colors.outlineVariant} />
                <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                  {error ?? (query ? 'No athletes match your search' : 'No athletes registered yet')}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontWeight: '800' },
  countBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: { marginBottom: 14, backgroundColor: 'transparent' },
  list: { gap: 10, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
});
