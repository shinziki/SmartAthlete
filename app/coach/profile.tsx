import { getCurrentCoachRecord, getUpcomingSessions } from '@/lib/sessionService';
import { supabase } from '@/lib/supabase';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Dialog,
  Divider,
  IconButton,
  List,
  Portal,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

interface CoachProfileData {
  firstName: string;
  middleName: string;
  lastName: string;
  username: string;
  birthdate: string;
  gender: string;
}

function formatBirthdate(raw: string): string {
  if (!raw) return 'Not set';
  const d = new Date(`${raw}T00:00:00`);
  return isNaN(d.getTime())
    ? raw
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Coach Profile: account details, team overview, password, team report export, sign out.
 */
export default function CoachProfileScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [coachId, setCoachId] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<CoachProfileData>({
    firstName: '',
    middleName: '',
    lastName: '',
    username: '',
    birthdate: '',
    gender: '',
  });
  const [athleteCount, setAthleteCount] = useState<number | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [checkInCount, setCheckInCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editFields, setEditFields] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    username: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [pwVisible, setPwVisible] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const loadProfile = useCallback(
    async (isPullToRefresh = false) => {
      try {
        if (isPullToRefresh) setRefreshing(true);

        // Use the cached session (no network) so a flaky connection never kicks us to login.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;

        if (user) {
          const meta = user.user_metadata ?? {};
          setEmail(user.email ?? '');
          setProfile({
            firstName: meta.firstName ?? '',
            middleName: meta.middleName ?? '',
            lastName: meta.lastName ?? '',
            username: meta.username ?? '',
            birthdate: meta.birthdate ?? '',
            gender: meta.gender ?? '',
          });
        }

        const record = await getCurrentCoachRecord();
        setCoachId(record?.id ?? null);

        try {
          const [athletesRes, sessions] = await Promise.all([
            supabase.from('tbl_athletes').select('*', { count: 'exact', head: true }),
            getUpcomingSessions(),
          ]);
          setAthleteCount(athletesRes?.count ?? 0);

          const mine = record
            ? (sessions ?? []).filter((s) => Number(s.coachId) === record.id)
            : [];
          setSessionCount(mine.length);
          setCheckInCount(mine.reduce((sum, s) => sum + (s.acceptedAthletes?.length ?? 0), 0));
        } catch (statsErr) {
          console.warn('Error loading coach stats:', statsErr);
        }
      } catch (err) {
        console.warn('Error loading coach profile:', err);
      } finally {
        if (isPullToRefresh) setRefreshing(false);
      }
    },
    [router]
  );

  useFocusEffect(
    useCallback(() => {
      loadProfile(false);
    }, [loadProfile])
  );

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

  const openEditProfile = () => {
    setEditFields({
      firstName: profile.firstName,
      middleName: profile.middleName,
      lastName: profile.lastName,
      username: profile.username,
    });
    setEditVisible(true);
  };

  const handleSaveProfile = async () => {
    const f = {
      firstName: editFields.firstName.trim(),
      middleName: editFields.middleName.trim(),
      lastName: editFields.lastName.trim(),
      username: editFields.username.trim(),
    };
    if (!f.firstName || !f.lastName || !f.username) {
      Alert.alert('Missing details', 'First name, last name and username are required.');
      return;
    }
    setSavingProfile(true);
    try {
      if (coachId != null) {
        const { error } = await supabase.from('tbl_coaches').update(f).eq('id', coachId);
        if (error) throw error;
      }
      const { error: authError } = await supabase.auth.updateUser({ data: f });
      if (authError) throw authError;
      setProfile((prev) => ({ ...prev, ...f }));
      setEditVisible(false);
    } catch (err: any) {
      Alert.alert('Could not save profile', err.message || 'Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPw.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert('Passwords do not match', 'Enter the same password in both fields.');
      return;
    }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setPwVisible(false);
      setNewPw('');
      setConfirmPw('');
      Alert.alert('Password updated', 'Use your new password the next time you sign in.');
    } catch (err: any) {
      Alert.alert('Could not update password', err.message || 'Please try again.');
    } finally {
      setSavingPw(false);
    }
  };

  const handleExportTeamReport = async () => {
    setExporting(true);
    try {
      const [metricsRes, athletesRes] = await Promise.all([
        supabase
          .from('tbl_session_metrics')
          .select('*')
          .order('completed_at', { ascending: false }),
        supabase.from('tbl_athletes').select('id, firstName, lastName'),
      ]);
      if (metricsRes.error) throw metricsRes.error;
      const metrics = metricsRes.data ?? [];
      if (metrics.length === 0) {
        Alert.alert('Nothing to export', 'No athlete sessions have been recorded yet.');
        return;
      }

      const names: Record<string, string> = {};
      (athletesRes.data ?? []).forEach((a: any) => {
        names[String(a.id)] = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
      });

      const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header =
        'athlete,date,title,duration_seconds,load_au,steps,meters,jumps,avg_heart_rate,max_heart_rate,calories';
      const rows = metrics.map((m: any) =>
        [
          q(names[String(m.athlete_id)] ?? ''),
          new Date(m.completed_at).toISOString(),
          q(m.session_title),
          m.total_seconds,
          m.player_load_au,
          m.steps,
          m.meters,
          m.jumps,
          m.avg_heart_rate,
          m.max_heart_rate,
          m.calories_burned,
        ].join(',')
      );
      await Share.share({
        title: 'SmartAthlete team report',
        message: [header, ...rows].join('\n'),
      });
    } catch (err: any) {
      Alert.alert('Could not export report', err.message || 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const fullName =
    `${profile.firstName} ${profile.lastName}`.trim() || profile.username || 'Coach';
  const initials = fullName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadProfile(true)}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        <Text variant="headlineLarge" style={[styles.title, { color: theme.colors.onBackground }]}>
          Profile
        </Text>

        {/* ─── Profile Card ─── */}
        <Card
          mode="contained"
          style={[styles.profileCard, { backgroundColor: theme.colors.primaryContainer }]}
        >
          <Card.Content style={styles.profileCardContent}>
            <Avatar.Text
              size={64}
              label={initials}
              style={{ backgroundColor: theme.colors.primary }}
              color={theme.colors.onPrimary}
              labelStyle={{ fontWeight: '700', fontSize: 22 }}
            />
            <View style={styles.profileTextGroup}>
              <Text
                variant="titleLarge"
                style={{ color: theme.colors.onPrimaryContainer, fontWeight: '700' }}
              >
                {fullName}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
                {profile.username ? `@${profile.username}` : email}
              </Text>
              <Text
                variant="labelSmall"
                style={{ color: theme.colors.onPrimaryContainer, fontWeight: '600' }}
              >
                Coach{coachId != null ? ` · ID #${coachId}` : ''}
              </Text>
            </View>
            <IconButton
              icon="pencil-outline"
              mode="contained-tonal"
              onPress={openEditProfile}
              accessibilityLabel="Edit profile"
            />
          </Card.Content>
        </Card>

        {/* ─── Team Overview ─── */}
        <View style={styles.statsRow}>
          {[
            { label: 'Athletes', value: athleteCount },
            { label: 'Sessions', value: sessionCount },
            { label: 'Check-ins', value: checkInCount },
          ].map((stat) => (
            <View
              key={stat.label}
              style={[styles.statTile, { backgroundColor: theme.colors.surfaceVariant }]}
            >
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {stat.label}
              </Text>
              <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '800' }}>
                {stat.value ?? '--'}
              </Text>
            </View>
          ))}
        </View>

        {/* ─── Personal Details ─── */}
        <Card
          mode="elevated"
          style={[styles.sectionCard, { backgroundColor: theme.colors.elevation.level1 }]}
        >
          <Card.Content style={styles.listCardContent}>
            <Text variant="titleSmall" style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
              Personal details
            </Text>
            <List.Item
              title="Email"
              description={email || '--'}
              left={(p) => <List.Icon {...p} icon="email-outline" />}
            />
            <Divider />
            <List.Item
              title="Birthdate"
              description={formatBirthdate(profile.birthdate)}
              left={(p) => <List.Icon {...p} icon="cake-variant-outline" />}
            />
            <Divider />
            <List.Item
              title="Gender"
              description={profile.gender || 'Not set'}
              left={(p) => <List.Icon {...p} icon="account-outline" />}
            />
          </Card.Content>
        </Card>

        {/* ─── Team Data ─── */}
        <Card
          mode="elevated"
          style={[styles.sectionCard, { backgroundColor: theme.colors.elevation.level1 }]}
        >
          <Card.Content style={styles.listCardContent}>
            <Text variant="titleSmall" style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
              Team data
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Download every recorded athlete session (load, steps, jumps, heart rate) as a CSV
              file. Handle it under the same privacy rules as the app.
            </Text>
            <Button
              mode="outlined"
              icon="download-outline"
              onPress={handleExportTeamReport}
              loading={exporting}
              disabled={exporting}
              style={styles.exportButton}
            >
              Export team report
            </Button>
          </Card.Content>
        </Card>

        {/* ─── Account ─── */}
        <Card
          mode="elevated"
          style={[styles.sectionCard, { backgroundColor: theme.colors.elevation.level1 }]}
        >
          <Card.Content style={styles.listCardContent}>
            <Text variant="titleSmall" style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
              Account
            </Text>
            <List.Item
              title="Change password"
              left={(p) => <List.Icon {...p} icon="lock-outline" />}
              right={(p) => <List.Icon {...p} icon="chevron-right" />}
              onPress={() => setPwVisible(true)}
            />
            <Divider />
            <List.Item
              title="Sign out"
              titleStyle={{ color: theme.colors.error }}
              left={(p) => <List.Icon {...p} icon="logout" color={theme.colors.error} />}
              onPress={handleSignOut}
            />
          </Card.Content>
        </Card>

        <Text
          variant="labelSmall"
          style={[styles.versionText, { color: theme.colors.onSurfaceVariant }]}
        >
          SmartAthlete v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>

      <Portal>
        {/* ─── Edit Profile Dialog ─── */}
        <Dialog
          visible={editVisible}
          onDismiss={() => !savingProfile && setEditVisible(false)}
          style={[styles.dialog, { backgroundColor: theme.colors.elevation.level3 }]}
        >
          <Dialog.Title>Edit profile</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="First name"
              value={editFields.firstName}
              onChangeText={(v) => setEditFields((f) => ({ ...f, firstName: v }))}
              style={styles.dialogInput}
            />
            <TextInput
              mode="outlined"
              label="Middle name (optional)"
              value={editFields.middleName}
              onChangeText={(v) => setEditFields((f) => ({ ...f, middleName: v }))}
              style={styles.dialogInput}
            />
            <TextInput
              mode="outlined"
              label="Last name"
              value={editFields.lastName}
              onChangeText={(v) => setEditFields((f) => ({ ...f, lastName: v }))}
              style={styles.dialogInput}
            />
            <TextInput
              mode="outlined"
              label="Username"
              autoCapitalize="none"
              value={editFields.username}
              onChangeText={(v) => setEditFields((f) => ({ ...f, username: v }))}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditVisible(false)} disabled={savingProfile}>
              Cancel
            </Button>
            <Button onPress={handleSaveProfile} loading={savingProfile} disabled={savingProfile}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* ─── Change Password Dialog ─── */}
        <Dialog
          visible={pwVisible}
          onDismiss={() => !savingPw && setPwVisible(false)}
          style={[styles.dialog, { backgroundColor: theme.colors.elevation.level3 }]}
        >
          <Dialog.Title>Change password</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="New password"
              secureTextEntry
              autoCapitalize="none"
              value={newPw}
              onChangeText={setNewPw}
              style={styles.dialogInput}
            />
            <TextInput
              mode="outlined"
              label="Confirm new password"
              secureTextEntry
              autoCapitalize="none"
              value={confirmPw}
              onChangeText={setConfirmPw}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPwVisible(false)} disabled={savingPw}>
              Cancel
            </Button>
            <Button onPress={handleChangePassword} loading={savingPw} disabled={savingPw}>
              Update
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },
  title: {
    fontWeight: '400',
    marginTop: 8,
  },

  // Profile card
  profileCard: {
    borderRadius: 24,
  },
  profileCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  profileTextGroup: {
    flex: 1,
    gap: 2,
  },

  // Team overview
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statTile: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    gap: 2,
  },

  // Section cards
  sectionCard: {
    borderRadius: 24,
  },
  listCardContent: {
    paddingVertical: 4,
  },
  cardTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  exportButton: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    marginTop: 8,
  },
  versionText: {
    textAlign: 'center',
    marginTop: 4,
  },

  // Dialogs
  dialog: {
    borderRadius: 20,
    paddingVertical: 8,
  },
  dialogInput: {
    marginBottom: 10,
  },
});