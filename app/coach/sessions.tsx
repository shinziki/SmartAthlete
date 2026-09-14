import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, FAB, Icon, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────

type SessionType = 'Training' | 'S&C' | 'Scrimmage';

interface Session {
  id: string;
  title: string;
  type: SessionType;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  drillsCount?: number;
  totalDuration?: string;
}

// ─── Mock Data ────────────────────────────────────────────────

const upcomingSessions: Session[] = [
  {
    id: '1',
    title: 'S&C — Plyometrics',
    type: 'S&C',
    date: 'Today',
    startTime: '4:00',
    endTime: '6:00 PM',
    venue: 'EVSU Ormoc Gymnasium',
    drillsCount: 4,
    totalDuration: '70m',
  },
];

const recentSessions: Session[] = [
  {
    id: '2',
    title: 'Full-court transition drills',
    type: 'Training',
    date: 'Jul 22',
    startTime: '3:00',
    endTime: '5:00 PM',
    venue: 'EVSU Ormoc Gymnasium',
    drillsCount: 5,
    totalDuration: '90m',
  },
  {
    id: '3',
    title: 'Half-court sets & shooting',
    type: 'Training',
    date: 'Jul 21',
    startTime: '3:30',
    endTime: '5:30 PM',
    venue: 'EVSU Ormoc Gymnasium',
    drillsCount: 4,
    totalDuration: '60m',
  },
  {
    id: '4',
    title: 'Team scrimmage',
    type: 'Scrimmage',
    date: 'Jul 19',
    startTime: '4:00',
    endTime: '6:30 PM',
    venue: 'EVSU Ormoc Gymnasium',
    drillsCount: 3,
    totalDuration: '80m',
  },
];

// ─── Badge Colors ─────────────────────────────────────────────

const TYPE_BADGE_COLORS: Record<SessionType, { bg: string; text: string }> = {
  Training: { bg: '#D6F5D6', text: '#1B5E3B' },
  'S&C': { bg: '#D9ECEB', text: '#2E6B65' },
  Scrimmage: { bg: '#FCE8D5', text: '#8B5E3C' },
};

// ─── Session Card Component ──────────────────────────────────

function SessionCard({ session }: { session: Session }) {
  const theme = useTheme();
  const badge = TYPE_BADGE_COLORS[session.type];

  return (
    <Surface
      style={[
        styles.sessionCard,
        { backgroundColor: theme.colors.elevation.level1 },
      ]}
      elevation={0}
    >
      <View style={styles.cardTopRow}>
        <Text
          variant="titleMedium"
          style={[styles.sessionTitle, { color: theme.colors.onSurface }]}
          numberOfLines={1}
        >
          {session.title}
        </Text>
        <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.typeBadgeText, { color: badge.text }]}>
            {session.type}
          </Text>
        </View>
      </View>
      <Text
        variant="bodyMedium"
        style={[styles.sessionMeta, { color: theme.colors.onSurfaceVariant }]}
      >
        {session.date} · {session.startTime}–{session.endTime}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant }}
        >
          {session.venue}
        </Text>
        {session.drillsCount && (
          <Chip
            compact
            icon="clipboard-list-outline"
            style={{ backgroundColor: theme.colors.elevation.level2 }}
            textStyle={{ fontSize: 11, fontWeight: '600' }}
          >
            {session.drillsCount} drills ({session.totalDuration})
          </Chip>
        )}
      </View>
    </Surface>
  );
}

// ─── Main Screen ──────────────────────────────────────────────

export default function CoachSessionsScreen() {
  const theme = useTheme();
  const router = useRouter();

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

        {/* ─── Session List ─── */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Upcoming */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            UPCOMING
          </Text>
          {upcomingSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}

          {/* Recent */}
          <Text
            variant="labelLarge"
            style={[
              styles.sectionLabel,
              styles.sectionLabelSpaced,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            RECENT
          </Text>
          {recentSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
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
    paddingBottom: 24,
  },
  sectionLabel: {
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 8,
  },
  sectionLabelSpaced: {
    marginTop: 24,
  },

  // ─── Session Card ───
  sessionCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sessionTitle: {
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
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
  sessionMeta: {
    marginBottom: 2,
  },
});
