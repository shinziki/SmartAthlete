import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Card, Chip, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CompletedSessionMetrics } from '@/lib/trackingService';

// ─── Types ───────────────────────────────────────────────────

interface SessionMetric {
  label: string;
  value: string;
  unit?: string;
}

interface Session {
  id: string;
  date: string;
  title: string;
  type: string;
  duration: string;
  synced: boolean;
  metrics: SessionMetric[];
}

// ─── Sample Data ─────────────────────────────────────────────

const weeklyLoadData = [
  { week: 'W1', value: 45 },
  { week: 'W2', value: 72 },
  { week: 'W3', value: 38 },
  { week: 'W4', value: 85 },
];

const sessions: Session[] = [
  {
    id: '1',
    date: 'Jul 22',
    title: 'Full-court transition drills',
    type: 'Training',
    duration: '1h 58m',
    synced: true,
    metrics: [
      { label: 'LOAD', value: '612', unit: 'AU' },
      { label: 'JUMPS', value: '42' },
    ],
  },
  {
    id: '2',
    date: 'Jul 21',
    title: 'Half-court sets & shooting',
    type: 'Training',
    duration: '2h 04m',
    synced: true,
    metrics: [
      { label: 'LOAD', value: '548', unit: 'AU' },
      { label: 'SPRINTS', value: '16' },
    ],
  },
];

// ─── Weekly Load Trend Chart ─────────────────────────────────

function WeeklyLoadChart() {
  const theme = useTheme();
  const chartWidth = 280;
  const chartHeight = 100;
  const barWidth = 36;
  const maxValue = Math.max(...weeklyLoadData.map((d) => d.value));
  const barSpacing =
    (chartWidth - weeklyLoadData.length * barWidth) / (weeklyLoadData.length + 1);

  return (
    <View style={chartStyles.container}>
      <Svg width={chartWidth} height={chartHeight + 28} viewBox={`0 0 ${chartWidth} ${chartHeight + 28}`}>
        {weeklyLoadData.map((item, index) => {
          const barHeight = (item.value / maxValue) * (chartHeight - 16);
          const x = barSpacing + index * (barWidth + barSpacing);
          const y = chartHeight - barHeight;

          return (
            <React.Fragment key={item.week}>
              <Rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={6}
                ry={6}
                fill={theme.colors.primaryContainer}
              />
              <SvgText
                x={x + barWidth / 2}
                y={chartHeight + 20}
                textAnchor="middle"
                fontSize={12}
                fontWeight="500"
                fill={theme.colors.onSurfaceVariant}
              >
                {item.week}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
});

// ─── Session Card ────────────────────────────────────────────

function SessionCard({ session }: { session: Session }) {
  const theme = useTheme();

  return (
    <Card
      mode="elevated"
      style={[
        sessionStyles.card,
        { backgroundColor: theme.colors.elevation.level1 },
      ]}
    >
      <Card.Content style={sessionStyles.content}>
        {/* Header row: date + title + synced badge */}
        <View style={sessionStyles.headerRow}>
          <View style={sessionStyles.titleGroup}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '700' }}
            >
              {session.date} · {session.title}
            </Text>
          </View>
          {session.synced && (
            <Chip
              compact
              style={[
                sessionStyles.syncedChip,
                { backgroundColor: theme.colors.primaryContainer },
              ]}
              textStyle={{
                color: theme.colors.primary,
                fontSize: 11,
                fontWeight: '600',
              }}
            >
              Synced
            </Chip>
          )}
        </View>

        {/* Subtitle: type + duration */}
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
        >
          {session.type} · {session.duration}
        </Text>

        {/* Metric pills */}
        <View style={sessionStyles.metricsRow}>
          {session.metrics.map((metric) => (
            <View
              key={metric.label}
              style={[
                sessionStyles.metricPill,
                { backgroundColor: theme.colors.primaryContainer },
              ]}
            >
              <Text
                variant="labelSmall"
                style={{
                  color: theme.colors.primary,
                  fontWeight: '600',
                  letterSpacing: 0.6,
                  fontSize: 10,
                }}
              >
                {metric.label}
              </Text>
              <View style={sessionStyles.metricValueRow}>
                <Text
                  variant="headlineSmall"
                  style={{
                    color: theme.colors.onSurface,
                    fontWeight: '700',
                  }}
                >
                  {metric.value}
                </Text>
                {metric.unit && (
                  <Text
                    variant="bodySmall"
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      marginLeft: 4,
                      fontWeight: '500',
                    }}
                  >
                    {metric.unit}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </Card.Content>
    </Card>
  );
}

const sessionStyles = StyleSheet.create({
  card: {
    borderRadius: 20,
  },
  content: {
    gap: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleGroup: {
    flex: 1,
  },
  syncedChip: {
    height: 28,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  metricPill: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
    minWidth: 100,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
});

// ─── Main Screen ─────────────────────────────────────────────

export default function HistoryScreen() {
  const theme = useTheme();
  const [completedList, setCompletedList] = useState<Session[]>(sessions);

  useFocusEffect(
    useCallback(() => {
      const loadHistory = async () => {
        try {
          const raw = await AsyncStorage.getItem('@smartathlete_completed_sessions_v1');
          if (raw) {
            const parsed: CompletedSessionMetrics[] = JSON.parse(raw);
            if (parsed && parsed.length > 0) {
              const mapped: Session[] = parsed.map((item, idx) => ({
                id: `completed_${idx}_${item.sessionId}`,
                date: item.date,
                title: item.sessionTitle,
                type: 'Training',
                duration: item.durationFormatted,
                synced: true,
                metrics: [
                  { label: 'LOAD', value: `${Math.round(item.playerLoadAU)}`, unit: 'AU' },
                  { label: 'STEPS', value: `${item.steps.toLocaleString()}` },
                  {
                    label: 'DISTANCE',
                    value:
                      item.meters >= 1000
                        ? `${(item.meters / 1000).toFixed(2)}`
                        : `${Math.round(item.meters)}`,
                    unit: item.meters >= 1000 ? 'km' : 'm',
                  },
                  { label: 'JUMPS', value: `${item.jumps}` },
                ],
              }));
              setCompletedList([...mapped, ...sessions]);
              return;
            }
          }
          setCompletedList(sessions);
        } catch {
          setCompletedList(sessions);
        }
      };

      loadHistory();
    }, [])
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Page Title ─── */}
        <Text
          variant="headlineLarge"
          style={[styles.pageTitle, { color: theme.colors.onBackground }]}
        >
          Activity history
        </Text>

        {/* ─── Weekly Load Trend Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.trendCard,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content>
            <Text
              variant="titleSmall"
              style={{
                color: theme.colors.onSurface,
                fontWeight: '600',
                marginBottom: 4,
              }}
            >
              Weekly load trend
            </Text>
            <WeeklyLoadChart />
          </Card.Content>
        </Card>

        {/* ─── Session List ─── */}
        {completedList.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },
  pageTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  trendCard: {
    borderRadius: 20,
  },
});
