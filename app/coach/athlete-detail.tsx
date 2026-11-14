import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  HelperText,
  Icon,
  IconButton,
  Portal,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { JerseyBadge } from '@/components/coach/readiness';
import {
  AthleteSessionRecord,
  JERSEY_NUMBER_PATTERN,
  getAthleteSessions,
  getTakenJerseyNumbers,
  setJerseyNumber,
} from '@/lib/coachService';

/** All valid basketball numbers in the order a coach would scan them. */
const ALL_JERSEY_NUMBERS = ['0', '00', ...Array.from({ length: 99 }, (_, i) => String(i + 1))];

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
  const { id, name, jersey } = useLocalSearchParams<{ id: string; name?: string; jersey?: string }>();
  const athleteId = Number(id);

  // Jersey number assignment
  const [jerseyNumber, setJerseyNumberState] = useState<string | null>(jersey || null);
  const [jerseyDialogOpen, setJerseyDialogOpen] = useState(false);
  const [jerseyInput, setJerseyInput] = useState('');
  const [takenNumbers, setTakenNumbers] = useState<Map<string, { athleteId: number; name: string }>>(
    new Map()
  );
  const [savingJersey, setSavingJersey] = useState(false);
  const [jerseyError, setJerseyError] = useState<string | null>(null);
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

  const openJerseyDialog = async () => {
    setJerseyInput(jerseyNumber ?? '');
    setJerseyError(null);
    setJerseyDialogOpen(true);
    try {
      setTakenNumbers(await getTakenJerseyNumbers());
    } catch (err: any) {
      setJerseyError(err?.message ?? 'Could not load the numbers already in use.');
    }
  };

  const saveJersey = async (value: string | null) => {
    setSavingJersey(true);
    setJerseyError(null);
    try {
      await setJerseyNumber(athleteId, value);
      setJerseyNumberState(value);
      setJerseyDialogOpen(false);
    } catch (err: any) {
      setJerseyError(err?.message ?? 'Could not save the jersey number.');
    } finally {
      setSavingJersey(false);
    }
  };

  // Live feedback while typing
  const trimmedInput = jerseyInput.trim();
  const holder = takenNumbers.get(trimmedInput);
  const takenByOther = holder && holder.athleteId !== athleteId ? holder : null;
  const inputInvalid = trimmedInput !== '' && !JERSEY_NUMBER_PATTERN.test(trimmedInput);
  const freeSuggestions = ALL_JERSEY_NUMBERS.filter((n) => !takenNumbers.has(n)).slice(0, 8);

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

      {/* ─── Jersey number ─── */}
      <View style={styles.jerseyRow}>
        <JerseyBadge number={jerseyNumber} size="large" color={theme.colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
            JERSEY NUMBER
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {jerseyNumber ? `Wears #${jerseyNumber}` : 'No number assigned yet'}
          </Text>
        </View>
        <Button mode="contained-tonal" icon="tshirt-crew" onPress={openJerseyDialog}>
          {jerseyNumber ? 'Change' : 'Assign'}
        </Button>
      </View>

      <Portal>
        <Dialog visible={jerseyDialogOpen} onDismiss={() => !savingJersey && setJerseyDialogOpen(false)}>
          <Dialog.Title>Jersey number</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
              Use 0, 00, or 1–99. Each number can belong to one athlete.
            </Text>
            <TextInput
              mode="outlined"
              label="Number"
              value={jerseyInput}
              onChangeText={(t) => setJerseyInput(t.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
              left={<TextInput.Affix text="#" />}
              error={inputInvalid || !!takenByOther}
              autoFocus
            />
            <HelperText type="error" visible={inputInvalid || !!takenByOther || !!jerseyError}>
              {inputInvalid
                ? 'Use 0, 00, or a number from 1 to 99 (no other leading zeros).'
                : takenByOther
                ? `#${trimmedInput} is worn by ${takenByOther.name}.`
                : jerseyError ?? ''}
            </HelperText>
            {freeSuggestions.length > 0 && (
              <>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
                  AVAILABLE
                </Text>
                <View style={styles.suggestions}>
                  {freeSuggestions.map((n) => (
                    <Chip key={n} compact onPress={() => setJerseyInput(n)} selected={trimmedInput === n}>
                      #{n}
                    </Chip>
                  ))}
                </View>
              </>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            {jerseyNumber && (
              <Button
                textColor={theme.colors.error}
                onPress={() => saveJersey(null)}
                disabled={savingJersey}
              >
                Remove
              </Button>
            )}
            <Button onPress={() => setJerseyDialogOpen(false)} disabled={savingJersey}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={() => saveJersey(trimmedInput)}
              loading={savingJersey}
              disabled={savingJersey || !trimmedInput || inputInvalid || !!takenByOther}
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

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
                            <Stat label="Reps" value={`${d.reps || 0}`} />
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
  jerseyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  list: { padding: 20, gap: 12, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  card: { padding: 14, borderRadius: 18, borderWidth: 1, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1, alignItems: 'flex-start' },
  drill: { borderTopWidth: 1, paddingTop: 10, gap: 8 },
});

