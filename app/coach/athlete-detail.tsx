import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, IconButton, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AthleteSessionRecord, getAthleteSessions } from '@/lib/coachService';

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{value}</Text>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );
}

/** Coach view of one athlete: every completed session with its recorded metrics. */
export default function AthleteDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [sessions, setSessions] = useState<AthleteSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await getAthleteSessions(Number(id)));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load sessions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text variant="titleLarge" style={{ fontWeight: '800' }} numberOfLines={1}>
            {name || 'Athlete'}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {sessions.length} completed session{sessions.length === 1 ? '' : 's'}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
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
          {sessions.length === 0 && (
            <View style={styles.center}>
              <Icon source="clipboard-text-outline" size={56} color={theme.colors.outlineVariant} />
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                {error ?? 'No completed sessions yet'}
              </Text>
            </View>
          )}

          {sessions.map((s) => {
            const open = expanded === s.id;
            return (
              <Surface
                key={s.id}
                elevation={0}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.colors.elevation.level1,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
              >
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text variant="titleMedium" style={{ fontWeight: '700' }} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {fmtDate(s.completedAt)}
                    </Text>
                  </View>
                  <Text variant="titleMedium" style={{ fontWeight: '800', color: theme.colors.primary }}>
                    {s.playerLoadAu} AU
                  </Text>
                </View>

                <View style={styles.statRow}>
                  <Stat label="Duration" value={fmtDuration(s.totalSeconds)} />
                  <Stat label="Avg HR" value={s.avgHeartRate ? `${s.avgHeartRate}` : '—'} />
                  <Stat label="Max HR" value={s.maxHeartRate ? `${s.maxHeartRate}` : '—'} />
                  <Stat label="RPE" value={s.sessionRpe !== null ? `${s.sessionRpe}` : '—'} />
                </View>
                <View style={styles.statRow}>
                  <Stat label="Steps" value={`${s.steps}`} />
                  <Stat label="Distance" value={`${Math.round(s.meters)} m`} />
                  <Stat label="Jumps" value={`${s.jumps}`} />
                  <Stat label="Calories" value={`${s.calories}`} />
                </View>

                {s.watchName ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Watch: {s.watchName}
                  </Text>
                ) : null}

                {s.drills.length > 0 && (
                  <>
                    <Text
                      onPress={() => setExpanded(open ? null : s.id)}
                      style={{ color: theme.colors.primary, fontWeight: '700', marginTop: 4 }}
                    >
                      {open ? 'Hide drills' : `Show ${s.drills.length} drill${s.drills.length === 1 ? '' : 's'}`}
                    </Text>
                    {open &&
                      s.drills.map((d, i) => (
                        <View
                          key={i}
                          style={[styles.drill, { borderColor: theme.colors.outlineVariant }]}
                        >
                          <View style={styles.cardHead}>
                            <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                              {d.drillName}
                            </Text>
                            <Text style={{ fontWeight: '700' }}>{Math.round(d.playerLoadAU || 0)} AU</Text>
                          </View>
                          <View style={styles.statRow}>
                            <Stat label="Time" value={d.durationFormatted || fmtDuration(d.totalSeconds || 0)} />
                            <Stat label="Avg HR" value={d.avgHeartRate ? `${d.avgHeartRate}` : '—'} />
                            <Stat label="Max HR" value={d.maxHeartRate ? `${d.maxHeartRate}` : '—'} />
                            <Stat label="HR Rec." value={d.hrRecoveryDrop ? `${d.hrRecoveryDrop}` : '—'} />
                          </View>
                          <View style={styles.statRow}>
                            <Stat label="Steps" value={`${d.steps || 0}`} />
                            <Stat label="Distance" value={`${Math.round(d.meters || 0)} m`} />
                            <Stat label="Jumps" value={`${d.jumps || 0}`} />
                          </View>
                        </View>
                      ))}
                  </>
                )}
              </Surface>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: 20, paddingTop: 8 },
  list: { padding: 20, gap: 12, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  card: { padding: 14, borderRadius: 18, borderWidth: 1, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'flex-start' },
  drill: { borderTopWidth: 1, paddingTop: 10, gap: 8 },
});

