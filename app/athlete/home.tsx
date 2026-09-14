import ReadinessRing from '@/components/ReadinessRing';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Card,
  Chip,
  Divider,
  Icon,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Helpers ──────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ─── Mini Bar Chart Component ────────────────────────────────

function MiniBarChart({ color }: { color: string }) {
  const barHeights = [14, 22, 10, 28, 18];
  return (
    <View style={miniBarStyles.container}>
      {barHeights.map((h, i) => (
        <View
          key={i}
          style={[
            miniBarStyles.bar,
            {
              height: h,
              backgroundColor: color,
              opacity: i === barHeights.length - 1 ? 1 : 0.45,
            },
          ]}
        />
      ))}
    </View>
  );
}

const miniBarStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 30,
  },
  bar: {
    width: 6,
    borderRadius: 3,
  },
});

// ─── Main Screen ─────────────────────────────────────────────

const NEXT_SESSION_DRILLS = [
  { name: 'Dynamic Warm-up & Mobility', duration: 10, category: 'Warm-up', color: '#E65100', bg: '#FFE0B2' },
  { name: 'Acceleration Sprints (30m & 60m)', duration: 20, category: 'Conditioning', color: '#2E7D32', bg: '#C8E6C9' },
  { name: 'Agility Ladder & Cone Cuts', duration: 15, category: 'Tactics', color: '#1565C0', bg: '#BBDEFB' },
  { name: 'Cool-down & Static Stretch', duration: 15, category: 'Cool-down', color: '#00838F', bg: '#B2EBF2' },
];

export default function AthleteHomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [athleteName, setAthleteName] = useState<string>('Athlete');
  const [loading, setLoading] = useState(true);
  const [showRegime, setShowRegime] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/' as any);
          return;
        }

        if (!cancelled) {
          // Build full name from firstName + lastName stored during registration
          const meta = user.user_metadata;
          const first = meta?.firstName ?? '';
          const last = meta?.lastName ?? '';
          const fullName = `${first} ${last}`.trim();
          setAthleteName(fullName || user.email?.split('@')[0] || 'Athlete');
        }
      } catch (err) {
        console.error('Failed to load athlete data:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          styles.loadingContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  const initials = getInitials(athleteName);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View>
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.primary, fontWeight: '500' }}
              >
                {getGreeting()}
              </Text>
              <Text
                variant="headlineSmall"
                style={[styles.athleteName, { color: theme.colors.onBackground }]}
              >
                {athleteName} 👋
              </Text>
            </View>
          </View>
          <Avatar.Text
            size={44}
            label={initials}
            style={{ backgroundColor: theme.colors.primary }}
            color={theme.colors.onPrimary}
            labelStyle={{ fontWeight: '700', fontSize: 16 }}
          />
        </View>

        {/* ─── Today's Readiness Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.readinessCard,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content style={styles.readinessContent}>
            <Text
              variant="labelLarge"
              style={[
                styles.readinessTitle,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              TODAY'S READINESS
            </Text>

            <View style={styles.readinessRingWrapper}>
              <ReadinessRing
                value={65}
                size={150}
                strokeWidth={14}
                label="Moderate"
                sublabel="decision support"
              />
            </View>

            <Text
              variant="bodySmall"
              style={[
                styles.readinessDisclaimer,
                { color: theme.colors.outline },
              ]}
            >
              Coaching estimate — not a medical result
            </Text>
          </Card.Content>
        </Card>

        {/* ─── Stats Grid (2×2) ─── */}
        <View style={styles.statsGrid}>
          {/* Last Session */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              LAST SESSION
            </Text>
            <View style={styles.statValueRow}>
              <Text
                variant="headlineMedium"
                style={[styles.statValue, { color: theme.colors.onSurface }]}
              >
                612
              </Text>
              <Text
                variant="bodySmall"
                style={[styles.statUnit, { color: theme.colors.onSurfaceVariant }]}
              >
                AU
              </Text>
            </View>
          </Surface>

          {/* This Week */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              THIS WEEK
            </Text>
            <View style={styles.statValueRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text
                    variant="headlineMedium"
                    style={[styles.statValue, { color: theme.colors.onSurface }]}
                  >
                    5
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={[
                      styles.statUnit,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    sessions
                  </Text>
                </View>
              </View>
              <MiniBarChart color={theme.colors.primary} />
            </View>
          </Surface>

          {/* Attendance */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              ATTENDANCE
            </Text>
            <View style={styles.statValueRow}>
              <Text
                variant="headlineMedium"
                style={[styles.statValue, { color: theme.colors.onSurface }]}
              >
                100
              </Text>
              <Text
                variant="bodySmall"
                style={[styles.statUnit, { color: theme.colors.onSurfaceVariant }]}
              >
                %
              </Text>
            </View>
          </Surface>

          {/* Jumps (WK) */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              JUMPS (WK)
            </Text>
            <Text
              variant="headlineMedium"
              style={[styles.statValue, { color: theme.colors.onSurface }]}
            >
              186
            </Text>
          </Surface>
        </View>

        {/* ─── Next Session Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.nextSessionCard,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content style={{ gap: 12 }}>
            <View style={styles.nextSessionHeaderRow}>
              <Text
                variant="titleMedium"
                style={[styles.nextSessionTitle, { color: theme.colors.onSurface }]}
              >
                Next Session
              </Text>
              <Chip
                compact
                icon="clock-outline"
                style={{ backgroundColor: theme.colors.primaryContainer }}
                textStyle={{
                  color: theme.colors.primary,
                  fontWeight: '700',
                  fontSize: 11,
                }}
              >
                4 drills · 60m
              </Chip>
            </View>

            <View style={styles.nextSessionRow}>
              <View
                style={[
                  styles.nextSessionIcon,
                  { backgroundColor: theme.colors.primaryContainer },
                ]}
              >
                <Icon
                  source="run-fast"
                  size={24}
                  color={theme.colors.primary}
                />
              </View>
              <View style={styles.nextSessionInfo}>
                <Text
                  variant="bodyLarge"
                  style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                >
                  Sprint Training
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Tomorrow · 8:00 AM · Court A
                </Text>
              </View>
            </View>

            <Divider style={{ marginVertical: 2 }} />

            {/* Training Regime Header Toggle */}
            <Pressable
              onPress={() => setShowRegime(!showRegime)}
              style={styles.regimeToggleRow}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon source="clipboard-list-outline" size={18} color={theme.colors.primary} />
                <Text
                  variant="labelMedium"
                  style={{ color: theme.colors.primary, fontWeight: '700' }}
                >
                  Training Regime (4 drills)
                </Text>
              </View>
              <Icon
                source={showRegime ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={theme.colors.primary}
              />
            </Pressable>

            {/* Drills List with Duration */}
            {showRegime && (
              <View style={styles.regimeList}>
                {NEXT_SESSION_DRILLS.map((d, i) => (
                  <View
                    key={i}
                    style={[
                      styles.regimeItem,
                      { backgroundColor: theme.colors.elevation.level2 },
                    ]}
                  >
                    <View style={styles.regimeItemLeft}>
                      <View style={styles.regimeIndexBadge}>
                        <Text style={styles.regimeIndexText}>#{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          variant="bodyMedium"
                          style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                          numberOfLines={1}
                        >
                          {d.name}
                        </Text>
                        <View style={{ flexDirection: 'row', marginTop: 2 }}>
                          <View
                            style={[
                              styles.regimeCategoryTag,
                              { backgroundColor: d.bg },
                            ]}
                          >
                            <Text
                              style={{
                                color: d.color,
                                fontSize: 9,
                                fontWeight: '700',
                              }}
                            >
                              {d.category}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.regimeDurationBadge,
                        { backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <Icon source="clock-outline" size={12} color={theme.colors.primary} />
                      <Text
                        variant="labelSmall"
                        style={{
                          color: theme.colors.primary,
                          fontWeight: '700',
                          fontSize: 11,
                        }}
                      >
                        {d.duration}m
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerLeft: {
    flex: 1,
  },
  athleteName: {
    fontWeight: '700',
    marginTop: 2,
  },

  // Readiness Card
  readinessCard: {
    borderRadius: 20,
  },
  readinessContent: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  readinessTitle: {
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  readinessRingWrapper: {
    marginVertical: 8,
  },
  readinessDisclaimer: {
    fontStyle: 'italic',
  },

  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  statLabel: {
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  statValue: {
    fontWeight: '700',
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statUnit: {
    fontWeight: '500',
    marginBottom: 2,
  },

  // Next Session
  nextSessionCard: {
    borderRadius: 20,
  },
  nextSessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextSessionTitle: {
    fontWeight: '700',
  },
  nextSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nextSessionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextSessionInfo: {
    flex: 1,
    gap: 2,
  },
  regimeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  regimeList: {
    gap: 8,
  },
  regimeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  regimeItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  regimeIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regimeIndexText: {
    fontSize: 10,
    fontWeight: '700',
  },
  regimeCategoryTag: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  regimeDurationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 8,
  },
});
