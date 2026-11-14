import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Vibration, View } from 'react-native';
import { notifySessionEvent } from '@/lib/sessionNotifications';
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  FAB,
  Icon,
  IconButton,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  athleteSyncState,
  AthleteSyncState,
  DbSession,
  deleteSession,
  getSessionProgress,
  getUpcomingSessions,
  isSessionEnded,
  isSessionProgressAvailable,
  SessionProgress,
  SessionType,
} from '../../lib/sessionService';

// ─── Athlete venue boundary (from tbl_session_progress) ───────

const BOUNDARY_BADGE: Record<'near_edge' | 'outside' | 'stopped', { icon: string; color: string; bg: string; label: string }> = {
  near_edge: { icon: 'map-marker-alert-outline', color: '#92400E', bg: '#FEF3C7', label: 'Near edge' },
  outside: { icon: 'map-marker-off-outline', color: '#B91C1C', bg: '#FEE2E2', label: 'Outside venue' },
  stopped: { icon: 'stop-circle-outline', color: '#7F1D1D', bg: '#FECACA', label: 'Stopped · left venue' },
};

/** Boundary badge to show for a progress row, or null (inside / at home / not live). */
function boundaryOf(p: SessionProgress): keyof typeof BOUNDARY_BADGE | null {
  const b = p.boundaryStatus;
  if (b === 'stopped') return 'stopped';
  if ((b === 'near_edge' || b === 'outside') && athleteSyncState(p) === 'live') return b;
  return null;
}

// ─── Athlete sync status (from tbl_session_progress) ─────────

const SYNC_BADGE: Record<AthleteSyncState, { icon: string; color: string; bg: string; label: string }> = {
  live: { icon: 'access-point', color: '#1D4ED8', bg: '#DBEAFE', label: 'Live' },
  pending: { icon: 'cloud-sync-outline', color: '#92400E', bg: '#FEF3C7', label: 'Pending sync' },
  synced: { icon: 'cloud-check-outline', color: '#2E7D32', bg: '#DCFCE7', label: 'Synced' },
};

// ─── Badge Colors ─────────────────────────────────────────────

const TYPE_BADGE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  training: { bg: '#D6F5D6', text: '#1B5E3B', label: 'Training' },
  sc: { bg: '#D9ECEB', text: '#2E6B65', label: 'S&C' },
  scrimmage: { bg: '#FCE8D5', text: '#8B5E3C', label: 'Scrimmage' },
};

// ─── Session Card Component ──────────────────────────────────

interface SessionCardProps {
  session: DbSession;
  onDelete: (sessionId: string | number, sessionTitle: string) => void;
  /** Shown only for upcoming sessions; ended sessions can't be edited */
  onEdit?: (sessionId: string | number) => void;
  /** Live progress rows keyed "sessionId:athleteId" */
  progress: Map<string, SessionProgress>;
}

function SessionCard({ session, onDelete, onEdit, progress }: SessionCardProps) {
  const theme = useTheme();
  const [showAttendees, setShowAttendees] = useState(false);
  const badge = TYPE_BADGE_COLORS[session.sessionType] || {
    bg: '#E2E8F0',
    text: '#334155',
    label: session.sessionType,
  };

  const venueLabel =
    session.locationType === 'at_home'
      ? '🏠 At Home'
      : session.venueName
      ? `📍 ${session.venueName}`
      : '📍 Ormoc Venue';

  const attendees = session.acceptedAthletes || [];
  const progressOf = (athleteId: number) => progress.get(`${session.id}:${athleteId}`);
  const pendingCount = attendees.filter((a) => {
    const p = progressOf(a.athleteId);
    return p && athleteSyncState(p) === 'pending';
  }).length;
  // Live counts shown on the card itself (no need to open the roster)
  const liveCount = attendees.filter((a) => {
    const p = progressOf(a.athleteId);
    return p && athleteSyncState(p) === 'live';
  }).length;
  const syncedCount = attendees.filter((a) => {
    const p = progressOf(a.athleteId);
    return p && athleteSyncState(p) === 'synced';
  }).length;
  const outsideCount = attendees.filter((a) => {
    const p = progressOf(a.athleteId);
    return p && boundaryOf(p) === 'outside';
  }).length;
  const nearEdgeCount = attendees.filter((a) => {
    const p = progressOf(a.athleteId);
    return p && boundaryOf(p) === 'near_edge';
  }).length;
  const ended = isSessionEnded(session);

  return (
    <Surface
      style={[
        styles.sessionCard,
        { backgroundColor: theme.colors.elevation.level1, opacity: ended ? 0.65 : 1 },
      ]}
      elevation={0}
    >
      {/* Top Row: Title, Type Badge, and Edit / Delete Buttons */}
      <View style={styles.cardTopRow}>
        <View style={styles.titleWithBadge}>
          <Text
            variant="titleMedium"
            style={[styles.sessionTitle, { color: theme.colors.onSurface }]}
            numberOfLines={1}
          >
            {session.title}
          </Text>
          <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.typeBadgeText, { color: badge.text }]}>
              {badge.label}
            </Text>
          </View>
          {ended && (
            <View style={[styles.typeBadge, { backgroundColor: '#E2E8F0' }]}>
              <Text style={[styles.typeBadgeText, { color: '#475569' }]}>Ended</Text>
            </View>
          )}
        </View>

        {onEdit && !ended && (
          <IconButton
            icon="pencil-outline"
            size={20}
            iconColor={theme.colors.primary}
            style={styles.deleteButton}
            onPress={() => onEdit(session.id)}
            accessibilityLabel={`Edit session ${session.title}`}
          />
        )}
        <IconButton
          icon="trash-can-outline"
          size={20}
          iconColor={theme.colors.error}
          style={styles.deleteButton}
          onPress={() => onDelete(session.id, session.title)}
          accessibilityLabel={`Delete session ${session.title}`}
        />
      </View>

      {/* Date & Time */}
      <Text
        variant="bodyMedium"
        style={[styles.sessionMeta, { color: theme.colors.onSurfaceVariant }]}
      >
        {session.date} · {session.startTime}–{session.endTime}
      </Text>

      {/* Venue & Drills Summary */}
      <View style={styles.venueAndDrillsRow}>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}
          numberOfLines={1}
        >
          {venueLabel}
        </Text>
        {session.drills && session.drills.length > 0 && (
          <Chip
            compact
            icon="clipboard-list-outline"
            style={{ backgroundColor: theme.colors.elevation.level2 }}
            textStyle={{ fontSize: 11, fontWeight: '600' }}
          >
            {session.drills.length} drills ({session.totalDurationMinutes}m)
          </Chip>
        )}
      </View>

      <Divider style={{ marginVertical: 10 }} />

      {/* Accepted Athletes Section with Athlete ID Numbers */}
      <View style={styles.attendeesSection}>
        <View style={styles.attendeesHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon
              source={attendees.length > 0 ? 'account-check' : 'account-clock-outline'}
              size={18}
              color={attendees.length > 0 ? '#2E7D32' : theme.colors.onSurfaceVariant}
            />
            <Text
              variant="labelMedium"
              style={{
                color: attendees.length > 0 ? '#2E7D32' : theme.colors.onSurfaceVariant,
                fontWeight: '700',
              }}
            >
              {attendees.length} {attendees.length === 1 ? 'Athlete' : 'Athletes'} Accepted
            </Text>
            {liveCount > 0 && (
              <View style={[styles.syncChip, { backgroundColor: SYNC_BADGE.live.bg }]}>
                <Icon source={SYNC_BADGE.live.icon} size={12} color={SYNC_BADGE.live.color} />
                <Text style={[styles.syncChipText, { color: SYNC_BADGE.live.color }]}>
                  {liveCount} live
                </Text>
              </View>
            )}
            {syncedCount > 0 && (
              <View style={[styles.syncChip, { backgroundColor: SYNC_BADGE.synced.bg }]}>
                <Icon source={SYNC_BADGE.synced.icon} size={12} color={SYNC_BADGE.synced.color} />
                <Text style={[styles.syncChipText, { color: SYNC_BADGE.synced.color }]}>
                  {syncedCount} synced
                </Text>
              </View>
            )}
            {outsideCount > 0 && (
              <View style={[styles.syncChip, { backgroundColor: BOUNDARY_BADGE.outside.bg }]}>
                <Icon source={BOUNDARY_BADGE.outside.icon} size={12} color={BOUNDARY_BADGE.outside.color} />
                <Text style={[styles.syncChipText, { color: BOUNDARY_BADGE.outside.color }]}>
                  {outsideCount} outside venue
                </Text>
              </View>
            )}
            {nearEdgeCount > 0 && (
              <View style={[styles.syncChip, { backgroundColor: BOUNDARY_BADGE.near_edge.bg }]}>
                <Icon source={BOUNDARY_BADGE.near_edge.icon} size={12} color={BOUNDARY_BADGE.near_edge.color} />
                <Text style={[styles.syncChipText, { color: BOUNDARY_BADGE.near_edge.color }]}>
                  {nearEdgeCount} near edge
                </Text>
              </View>
            )}
            {pendingCount > 0 && (
              <View style={[styles.syncChip, { backgroundColor: SYNC_BADGE.pending.bg }]}>
                <Icon source={SYNC_BADGE.pending.icon} size={12} color={SYNC_BADGE.pending.color} />
                <Text style={[styles.syncChipText, { color: SYNC_BADGE.pending.color }]}>
                  {pendingCount} pending sync
                </Text>
              </View>
            )}
          </View>

          {attendees.length > 0 && (
            <Button
              mode="text"
              compact
              onPress={() => setShowAttendees(!showAttendees)}
              labelStyle={{ fontSize: 12, marginHorizontal: 4 }}
            >
              {showAttendees ? 'Hide' : 'View Roster'}
            </Button>
          )}
        </View>

        {/* Accepted Athletes List with Athlete ID Numbers */}
        {attendees.length > 0 && showAttendees && (
          <View style={styles.attendeesList}>
            {attendees.map((att, idx) => (
              <View
                key={`${att.athleteId}-${idx}`}
                style={[
                  styles.attendeePill,
                  { backgroundColor: theme.colors.elevation.level2 },
                ]}
              >
                <View style={styles.athleteIdBadge}>
                  <Text style={styles.athleteIdText}>ID #{att.athleteId}</Text>
                </View>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1 }}
                  numberOfLines={1}
                >
                  {att.athleteName}
                </Text>
                {(() => {
                  const p = progressOf(att.athleteId);
                  if (!p) return <Icon source="check-circle" size={14} color="#2E7D32" />;
                  const badge = SYNC_BADGE[athleteSyncState(p)];
                  const detail =
                    athleteSyncState(p) === 'live' && p.totalDrills > 0
                      ? ` · Drill ${Math.min(p.drillsCompleted + 1, p.totalDrills)}/${p.totalDrills}`
                      : athleteSyncState(p) === 'pending' && p.syncedAt
                      ? ` · last ${new Date(p.syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                      : '';
                  const zone = boundaryOf(p);
                  return (
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <View style={[styles.syncChip, { backgroundColor: badge.bg }]}>
                        <Icon source={badge.icon} size={12} color={badge.color} />
                        <Text style={[styles.syncChipText, { color: badge.color }]}>
                          {badge.label}
                          {detail}
                        </Text>
                      </View>
                      {zone && (
                        <View style={[styles.syncChip, { backgroundColor: BOUNDARY_BADGE[zone].bg }]}>
                          <Icon source={BOUNDARY_BADGE[zone].icon} size={12} color={BOUNDARY_BADGE[zone].color} />
                          <Text style={[styles.syncChipText, { color: BOUNDARY_BADGE[zone].color }]}>
                            {BOUNDARY_BADGE[zone].label}
                            {zone !== 'stopped' && p.boundaryMeters != null ? ` · ${p.boundaryMeters}m` : ''}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}
              </View>
            ))}
          </View>
        )}
      </View>
    </Surface>
  );
}

// ─── Main Screen ──────────────────────────────────────────────

export default function CoachSessionsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState<Map<string, SessionProgress>>(new Map());

  // Re-evaluate every 30s so sessions end automatically once their end time passes.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Athletes' live / pending-sync / synced status and venue boundary. Every 30s normally,
  // every 10s while any athlete is training, so "outside venue" shows up quickly.
  const sessionIdsKey = sessions.map((s) => s.id).join(',');
  const [fastTick, setFastTick] = useState(0);
  const anyLive = Array.from(progress.values()).some((p) => athleteSyncState(p) === 'live');
  useEffect(() => {
    if (!anyLive) return;
    const id = setInterval(() => setFastTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [anyLive]);

  // Alert the coach once per athlete each time they go outside the venue
  const alertedOutside = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sessionIdsKey) return;
    let cancelled = false;
    getSessionProgress(sessionIdsKey.split(','))
      .then((map) => {
        if (cancelled) return;
        setProgress(map);
        for (const [key, p] of map) {
          const zone = boundaryOf(p);
          if (zone === 'outside' && !alertedOutside.current.has(key)) {
            alertedOutside.current.add(key);
            const session = sessions.find((x) => String(x.id) === String(p.sessionId));
            const who =
              session?.acceptedAthletes?.find((a) => Number(a.athleteId) === p.athleteId)?.athleteName ??
              `Athlete #${p.athleteId}`;
            Vibration.vibrate([0, 400, 200, 400]);
            notifySessionEvent(
              'Athlete outside the venue ⛔',
              `${who} left the ${session?.title ?? 'session'} area${p.boundaryMeters != null ? ` (${p.boundaryMeters}m from center)` : ''}.`
            );
          } else if (zone !== 'outside') {
            alertedOutside.current.delete(key); // back inside: alert again if they leave again
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // sessions is read for names only; refetch follows the ids and the ticks
  }, [sessionIdsKey, tick, fastTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSessions = sessions.filter((s) => !isSessionEnded(s));
  const endedSessions = sessions.filter((s) => isSessionEnded(s));

  const loadSessions = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const data = await getUpcomingSessions({ force: isRefresh });
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSessions(false);
    }, [loadSessions])
  );

  const handleEditSession = (sessionId: string | number) => {
    router.push({ pathname: '/coach/add-session', params: { id: String(sessionId) } } as any);
  };

  const handleDeleteSession = (sessionId: string | number, sessionTitle: string) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to remove "${sessionTitle}"? This will cancel the session and delete all accepted athlete check-ins for it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await deleteSession(sessionId);
              if (res.success) {
                setSessions((prev) => prev.filter((s) => s.id !== sessionId));
              } else {
                Alert.alert('Error', res.error || 'Failed to delete session.');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete session.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View style={styles.wrapper}>
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <Text
            variant="headlineMedium"
            style={[styles.headerTitle, { color: theme.colors.onBackground }]}
          >
            Sessions
          </Text>
          <FAB
            icon="plus"
            size="small"
            style={[styles.fab, { backgroundColor: theme.colors.primary }]}
            color={theme.colors.onPrimary}
            onPress={() => router.push('/coach/add-session' as any)}
          />
        </View>

        {/* ─── Sessions List ─── */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadSessions(true)}
              tintColor={theme.colors.primary}
            />
          }
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : sessions.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon
                source="calendar-blank-outline"
                size={56}
                color={theme.colors.outlineVariant}
              />
              <Text
                variant="titleMedium"
                style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
              >
                No upcoming sessions
              </Text>
              <Text
                variant="bodyMedium"
                style={[styles.emptySubtitle, { color: theme.colors.onSurfaceVariant }]}
              >
                Create a session to set training regimes and track athlete attendance.
              </Text>
              <Button
                mode="contained"
                icon="plus"
                onPress={() => router.push('/coach/add-session' as any)}
                style={styles.emptyButton}
              >
                Create session
              </Button>
            </View>
          ) : (
            <>
              <Text
                variant="labelLarge"
                style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
              >
                UPCOMING SESSIONS ({activeSessions.length})
              </Text>
              {isSessionProgressAvailable() === false && (
                <View style={[styles.syncChip, styles.setupNotice]}>
                  <Icon source="database-alert-outline" size={14} color="#92400E" />
                  <Text style={[styles.syncChipText, { color: '#92400E', flexShrink: 1 }]}>
                    Live / pending sync status needs the database update (supabase_session_progress.sql).
                  </Text>
                </View>
              )}
              {activeSessions.map((session) => (
                <SessionCard
                  key={String(session.id)}
                  session={session}
                  onDelete={handleDeleteSession}
                  onEdit={handleEditSession}
                  progress={progress}
                />
              ))}
              {endedSessions.length > 0 && (
                <>
                  <Text
                    variant="labelLarge"
                    style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
                  >
                    ENDED SESSIONS ({endedSessions.length})
                  </Text>
                  {endedSessions.map((session) => (
                    <SessionCard
                      key={String(session.id)}
                      session={session}
                      onDelete={handleDeleteSession}
                      progress={progress}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  wrapper: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontWeight: '700',
  },
  fab: {
    borderRadius: 16,
    elevation: 0,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 8,
  },

  // ─── Session Card ───
  sessionCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleWithBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 4,
  },
  sessionTitle: {
    fontWeight: '700',
    flexShrink: 1,
  },
  typeBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    margin: 0,
    width: 32,
    height: 32,
  },
  sessionMeta: {
    marginBottom: 6,
  },
  venueAndDrillsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },

  // ─── Attendees ───
  attendeesSection: {
    gap: 8,
  },
  attendeesHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  attendeesList: {
    gap: 6,
    marginTop: 4,
  },
  setupNotice: {
    backgroundColor: '#FEF3C7',
    alignSelf: 'stretch',
    marginBottom: 12,
    paddingVertical: 6,
  },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  syncChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  attendeePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 8,
  },
  athleteIdBadge: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  athleteIdText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // ─── Empty State ───
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontWeight: '700',
    marginTop: 8,
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  emptyButton: {
    borderRadius: 12,
  },
});
