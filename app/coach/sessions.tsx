import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
  DbSession,
  deleteSession,
  getUpcomingSessions,
  SessionType,
} from '../../lib/sessionService';

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
}

function SessionCard({ session, onDelete }: SessionCardProps) {
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

  return (
    <Surface
      style={[
        styles.sessionCard,
        { backgroundColor: theme.colors.elevation.level1 },
      ]}
      elevation={0}
    >
      {/* Top Row: Title, Type Badge, and Delete Button */}
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
        </View>

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
                <Icon source="check-circle" size={14} color="#2E7D32" />
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

  const loadSessions = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const data = await getUpcomingSessions();
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
                UPCOMING SESSIONS ({sessions.length})
              </Text>
              {sessions.map((session) => (
                <SessionCard
                  key={String(session.id)}
                  session={session}
                  onDelete={handleDeleteSession}
                />
              ))}
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
