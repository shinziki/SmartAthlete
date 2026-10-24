import {
  fetchAthleteSessionHistory,
  SessionMetricRecord,
} from '@/lib/sessionService';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Icon, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Helpers ─────────────────────────────────────────────────

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function formatDate(iso: string): { day: string; month: string; time: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { day: '--', month: '', time: '' };
  return {
    day: String(d.getDate()),
    month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

function formatDistance(meters: number): { value: string; unit: string } {
  return meters >= 1000
    ? { value: (meters / 1000).toFixed(2), unit: 'km' }
    : { value: String(Math.round(meters)), unit: 'm' };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

interface WeekBucket {
  label: string;
  total: number;
  sessions: number;
  isCurrent: boolean;
}

function buildWeeklyLoad(records: SessionMetricRecord[], weeks = 4): WeekBucket[] {
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => ({
    label: `W${i + 1}`,
    total: 0,
    sessions: 0,
    isCurrent: i === weeks - 1,
  }));
  const currentStart = startOfWeek(new Date()).getTime();

  for (const r of records) {
    const d = new Date(r.completedAt);
    if (isNaN(d.getTime())) continue;
    const weeksAgo = Math.round((currentStart - startOfWeek(d).getTime()) / WEEK_MS);
    const idx = weeks - 1 - weeksAgo;
    if (idx >= 0 && idx < weeks) {
      buckets[idx].total += r.playerLoadAU;
      buckets[idx].sessions += 1;
    }
  }
  return buckets;
}

// ─── Weekly Load Trend (no data yet) ─────────────────────────

// function WeeklyLoadEmpty() {
//   const theme = useTheme();
//   return (
//     <View style={emptyStyles.container}>
//       <View style={[emptyStyles.iconWrap, { backgroundColor: theme.colors.primaryContainer }]}>
//         <Icon source="chart-line-variant" size={26} color={theme.colors.primary} />
//       </View>
//       <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
//         No data yet
//       </Text>
//       <Text
//         variant="bodySmall"
//         style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
//       >
//         Your weekly load trend will appear here.
//       </Text>
//     </View>
//   );
// }

// const emptyStyles = StyleSheet.create({
//   container: { alignItems: 'center', paddingVertical: 20, gap: 6 },
//   iconWrap: {
//     width: 52,
//     height: 52,
//     borderRadius: 26,
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginBottom: 4,
//   },
// });

const PLOT_HEIGHT = 120;
const VALUE_LABEL_SPACE = 22;

function WeeklyLoadChart({ buckets }: { buckets: WeekBucket[] }) {
  const theme = useTheme();
  const max = Math.max(...buckets.map((b) => b.total));
  const hasData = max > 0;
  const current = buckets[buckets.length - 1];
  const previous = buckets[buckets.length - 2];
  const delta =
    previous && previous.total > 0
      ? Math.round(((current.total - previous.total) / previous.total) * 100)
      : null;
  const trendIcon =
    delta === null || delta === 0 ? 'minus' : delta > 0 ? 'trending-up' : 'trending-down';

  return (
    <View>
      <View style={chartStyles.headerRow}>
        <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurfaceVariant }}>
          {hasData ? `${Math.round(current.total).toLocaleString()} AU this week` : ''}
        </Text>
        {delta !== null ? (
          <View style={[chartStyles.chip, { backgroundColor: theme.colors.secondaryContainer }]}>
            <Icon source={trendIcon} size={14} color={theme.colors.onSecondaryContainer} />
            <Text
              style={{ color: theme.colors.onSecondaryContainer, fontSize: 12, fontWeight: '600' }}
            >
              {delta > 0 ? '+' : ''}
              {delta}% vs last week
            </Text>
          </View>
        ) : null}
      </View>

      <View style={chartStyles.plot}>
        {buckets.map((b) => {
          const barHeight =
            b.total > 0 ? Math.max(8, (b.total / max) * (PLOT_HEIGHT - VALUE_LABEL_SPACE)) : 4;
          return (
            <View
              key={b.label}
              style={chartStyles.column}
              accessible
              accessibilityLabel={`${b.label}: ${Math.round(b.total)} load AU across ${b.sessions} session${b.sessions === 1 ? '' : 's'}`}
            >
              {b.total > 0 ? (
                <Text
                  style={{
                    color: b.isCurrent ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
                    fontSize: 11,
                    fontWeight: b.isCurrent ? '700' : '500',
                    marginBottom: 4,
                  }}
                >
                  {Math.round(b.total).toLocaleString()}
                </Text>
              ) : null}
              <View
                style={[
                  chartStyles.bar,
                  {
                    height: barHeight,
                    backgroundColor:
                      b.total === 0
                        ? theme.colors.surfaceVariant
                        : b.isCurrent
                          ? theme.colors.primary
                          : theme.colors.primaryContainer,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={[chartStyles.baseline, { backgroundColor: theme.colors.outlineVariant }]} />

      <View style={chartStyles.labelsRow}>
        {buckets.map((b) => (
          <View key={b.label} style={chartStyles.column}>
            <Text
              style={{
                color: b.isCurrent ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
                fontSize: 11,
                fontWeight: b.isCurrent ? '700' : '500',
              }}
            >
              {b.label}
            </Text>
          </View>
        ))}
      </View>

      {!hasData ? (
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 12 }}
        >
          Finish a tracked session to see your weekly load.
        </Text>
      ) : null}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 16,
    minHeight: 24,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  plot: { height: PLOT_HEIGHT, flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: {
    width: '56%',
    maxWidth: 52,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  baseline: { height: StyleSheet.hairlineWidth },
  labelsRow: { flexDirection: 'row', marginTop: 8 },
});

// ─── Stat ────────────────────────────────────────────────────

function Stat({
  icon,
  label,
  value,
  unit,
}: {
  icon: string;
  label: string;
  value: string;
  unit?: string;
}) {
  const theme = useTheme();
  return (
    <View style={sessionStyles.stat}>
      <View style={sessionStyles.statLabelRow}>
        <Icon source={icon} size={12} color={theme.colors.onSurfaceVariant} />
        <Text
          style={{
            color: theme.colors.onSurfaceVariant,
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.6,
          }}
        >
          {label}
        </Text>
      </View>
      <View style={sessionStyles.statValueRow}>
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
          {value}
        </Text>
        {unit ? (
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, marginLeft: 3 }}
          >
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Session Card ────────────────────────────────────────────

function SessionCard({ record }: { record: SessionMetricRecord }) {
  const theme = useTheme();
  const date = formatDate(record.completedAt);
  const distance = formatDistance(record.meters);

  return (
    <Card
      mode="elevated"
      style={[sessionStyles.card, { backgroundColor: theme.colors.elevation.level1 }]}
    >
      <Card.Content style={sessionStyles.content}>
        <View style={sessionStyles.headerRow}>
          <View style={[sessionStyles.dateBadge, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '800' }}>
              {date.day}
            </Text>
            <Text
              style={{
                color: theme.colors.primary,
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 0.8,
              }}
            >
              {date.month}
            </Text>
          </View>

          <View style={sessionStyles.titleGroup}>
            <Text
              variant="titleSmall"
              numberOfLines={2}
              style={{ color: theme.colors.onSurface, fontWeight: '700' }}
            >
              {record.sessionTitle}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
              {date.time} · {formatDuration(record.totalSeconds)}
              {record.watchName ? ` · ${record.watchName}` : ''}
            </Text>
          </View>

          <View style={sessionStyles.loadBlock}>
            <Text
              style={{ color: theme.colors.primary, fontSize: 24, fontWeight: '800', lineHeight: 28 }}
            >
              {Math.round(record.playerLoadAU)}
            </Text>
            <Text
              style={{
                color: theme.colors.onSurfaceVariant,
                fontSize: 10,
                fontWeight: '600',
                letterSpacing: 0.6,
              }}
            >
              LOAD AU
            </Text>
          </View>
        </View>

        <View style={[sessionStyles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

        <View style={sessionStyles.statsRow}>
          <Stat icon="shoe-print" label="STEPS" value={record.steps.toLocaleString()} />
          <Stat icon="map-marker-distance" label="DISTANCE" value={distance.value} unit={distance.unit} />
          <Stat icon="arrow-up-bold" label="JUMPS" value={String(record.jumps)} />
          <Stat
            icon="heart-pulse"
            label="AVG HR"
            value={record.avgHeartRate > 0 ? String(record.avgHeartRate) : '--'}
            unit={record.avgHeartRate > 0 ? 'bpm' : undefined}
          />
        </View>
      </Card.Content>
    </Card>
  );
}

const sessionStyles = StyleSheet.create({
  card: { borderRadius: 20 },
  content: { gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateBadge: {
    width: 48,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleGroup: { flex: 1 },
  loadBlock: { alignItems: 'flex-end' },
  divider: { height: StyleSheet.hairlineWidth },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { gap: 2, flex: 1 },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline' },
});

// ─── Main Screen ─────────────────────────────────────────────

export default function HistoryScreen() {
  const theme = useTheme();
  const [records, setRecords] = useState<SessionMetricRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await fetchAthleteSessionHistory();
    setRecords(data);
    setError(err ?? null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const weeklyBuckets = useMemo(() => buildWeeklyLoad(records), [records]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
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
      >
        <View>
          <Text
            variant="headlineLarge"
            style={[styles.pageTitle, { color: theme.colors.onBackground }]}
          >
            Activity history
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {records.length} completed session{records.length === 1 ? '' : 's'}
          </Text>
        </View>

        <Card
          mode="elevated"
          style={[styles.trendCard, { backgroundColor: theme.colors.elevation.level1 }]}
        >
          <Card.Content>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '600' }}
            >
              Weekly load trend
            </Text>
            <WeeklyLoadChart buckets={weeklyBuckets} />
          </Card.Content>
        </Card>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: theme.colors.error, textAlign: 'center' }}>
            Couldn't load history: {error}
          </Text>
        ) : records.length === 0 ? (
          <View style={styles.emptyList}>
            <Icon source="history" size={40} color={theme.colors.onSurfaceVariant} />
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
              No sessions yet
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
            >
              Completed tracking sessions will show up here.
            </Text>
          </View>
        ) : (
          records.map((r) => <SessionCard key={r.id} record={r} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32, gap: 16 },
  pageTitle: { fontWeight: '700' },
  trendCard: { borderRadius: 20 },
  emptyList: { alignItems: 'center', gap: 6, paddingVertical: 32 },
});
