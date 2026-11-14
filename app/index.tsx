import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Avatar, Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { getSavedCoachEmail } from '@/lib/coachSession';
import { findAccountByEmail } from '@/lib/accountLookup';
import { getSignedInRole, hasStoredAuthSession, saveSignedInRole } from '@/lib/authRole';

export default function WelcomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ]);

    const restoreSession = async () => {
      // Role saved at sign-in: used whenever the server can't be reached, so an athlete
      // who opens the app offline is never sent to the coach side
      const savedRole = await getSignedInRole();
      const savedCoach = await getSavedCoachEmail();
      const offlineRole = savedRole ?? (savedCoach ? 'coach' : 'athlete');
      const go = (role: 'athlete' | 'coach') =>
        router.replace((role === 'athlete' ? '/athlete/device-check' : '/coach/home') as any);

      try {
        // Persisted Supabase session (time-limited: a stuck token refresh must not hang start-up)
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession(), 8000);

        if (cancelled) return;

        if (session?.user) {
          const email = session.user.email ?? '';
          const athlete = await findAccountByEmail('tbl_athletes', email, 'id').catch(
            (error) => ({ data: null, error })
          );
          if (cancelled) return;

          if (athlete.data) {
            saveSignedInRole('athlete');
            go('athlete');
            return;
          }
          if (athlete.error) {
            // Couldn't check (no internet): don't guess "coach"
            go(offlineRole);
            return;
          }

          // Checked: not an athlete. Confirm it's a coach rather than assuming.
          const coach = await findAccountByEmail('tbl_coaches', email, 'id').catch(
            (error) => ({ data: null, error })
          );
          if (cancelled) return;
          if (coach.data) {
            saveSignedInRole('coach');
            go('coach');
            return;
          }
          if (coach.error) {
            go(offlineRole);
            return;
          }
          // Signed in but no profile in either table: show the welcome screen
        } else if (savedCoach) {
          // No Supabase auth session: fall back to a saved coach login
          const coach = await findAccountByEmail('tbl_coaches', savedCoach, 'id').catch(
            (error) => ({ data: null, error })
          );
          if (cancelled) return;
          if (coach.data || coach.error) {
            // (offline: trust the saved coach login)
            go('coach');
            return;
          }
        }
      } catch (err) {
        console.warn('Session restore error:', err);
        // Session check timed out: continue as whoever is signed in on this phone
        if (!cancelled && (savedRole || (await hasStoredAuthSession()))) {
          go(offlineRole);
          return;
        }
      }

      // No valid session found → show welcome screen
      if (!cancelled) {
        setCheckingSession(false);
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // ─── Loading state while checking persisted session ───
  if (checkingSession) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text
            variant="bodyMedium"
            style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}
          >
            Loading…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        {/* ─── Branding Header ─── */}
        <View style={styles.header}>
          <Avatar.Icon
            size={80}
            icon="run-fast"
            style={{ backgroundColor: theme.colors.primary }}
            color={theme.colors.onPrimary}
          />
          <Text
            variant="headlineMedium"
            style={[styles.title, { color: theme.colors.onBackground }]}
          >
            SmartAthlete
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            EVSU Ormoc · Athletic Management
          </Text>
        </View>

        {/* ─── Role Selection ─── */}
        <View style={styles.roleContainer}>
          <Text
            variant="titleMedium"
            style={[styles.sectionTitle, { color: theme.colors.onBackground }]}
          >
            Choose your portal to continue
          </Text>

          {/* Athlete Card / Button */}
          <Button
            mode="contained"
            icon="account"
            onPress={() => router.push('/athlete-sign-in')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
            labelStyle={styles.actionButtonLabel}
          >
            Sign in as Athlete
          </Button>

          {/* Coach Card / Button */}
          <Button
            mode="outlined"
            icon="whistle"
            onPress={() => router.push('/coach-sign-in')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
            labelStyle={styles.actionButtonLabel}
          >
            Sign in as Coach
          </Button>
        </View>

        {/* ─── Footer ─── */}
        <View style={styles.footer}>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
          >
            Data protected under RA 10173 (Data Privacy Act)
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    letterSpacing: 0.2,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginTop: 32,
  },
  title: {
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 4,
  },
  roleContainer: {
    width: '100%',
    gap: 16,
  },
  sectionTitle: {
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  actionButton: {
    borderRadius: 24,
  },
  actionButtonContent: {
    paddingVertical: 8,
  },
  actionButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 8,
  },
});
