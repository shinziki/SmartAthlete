import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Divider,
  Icon,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Coach Profile — Account information and sign out.
 */
export default function CoachProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [coach, setCoach] = useState<{
    first_name: string;
    last_name: string;
    email: string;
    username: string;
  } | null>(null);

  useEffect(() => {
    const loadCoachProfile = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user?.email) {
          const { data } = await supabase
            .from('tbl_coaches')
            .select('first_name, last_name, email, username')
            .ilike('email', session.user.email)
            .maybeSingle();

          if (data) {
            setCoach(data);
          }
        }
      } catch (err) {
        console.warn('Error loading coach profile:', err);
      }
    };

    loadCoachProfile();
  }, []);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/');
        },
      },
    ]);
  };

  const fullName = coach
    ? `${coach.first_name ?? ''} ${coach.last_name ?? ''}`.trim()
    : 'Coach';

  const initials = fullName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text
          variant="headlineMedium"
          style={[styles.title, { color: theme.colors.onBackground }]}
        >
          Profile
        </Text>

        {/* ─── Profile Header ─── */}
        <View style={styles.profileHeader}>
          <Avatar.Text
            size={72}
            label={initials}
            style={{ backgroundColor: theme.colors.primaryContainer }}
            labelStyle={{ color: theme.colors.onPrimaryContainer }}
          />
          <Text
            variant="headlineSmall"
            style={[styles.nameText, { color: theme.colors.onBackground }]}
          >
            {fullName}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Coach
          </Text>
        </View>

        {/* ─── Info Section ─── */}
        <Surface
          style={[styles.infoCard, { backgroundColor: theme.colors.elevation.level1 }]}
          elevation={0}
        >
          <View style={styles.infoRow}>
            <Icon source="email-outline" size={20} color={theme.colors.onSurfaceVariant} />
            <View style={styles.infoContent}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Email
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                {coach?.email ?? '—'}
              </Text>
            </View>
          </View>
          <Divider style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Icon source="account-outline" size={20} color={theme.colors.onSurfaceVariant} />
            <View style={styles.infoContent}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Username
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                {coach?.username ?? '—'}
              </Text>
            </View>
          </View>
        </Surface>

        {/* ─── Sign Out ─── */}
        <Button
          mode="outlined"
          icon="logout"
          onPress={handleSignOut}
          style={styles.signOutButton}
          textColor={theme.colors.error}
        >
          Sign Out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  title: {
    fontWeight: '700',
    marginBottom: 24,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  nameText: {
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 2,
  },
  infoCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  infoContent: {
    flex: 1,
  },
  infoDivider: {
    marginVertical: 4,
  },
  signOutButton: {
    borderRadius: 24,
    borderColor: '#BA1A1A',
  },
});
