import AppearanceSelector from '@/components/profile/AppearanceSelector';
import PersonalInfoCard from '@/components/profile/PersonalInfoCard';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import { MenuGroup, MenuRow, SectionHeader } from '@/components/profile/ProfileMenu';
import { clearCoachLogin } from '@/lib/coachSession';
import { getProfilePhotoUrl } from '@/lib/profilePhoto';
import { getJerseyNumbersByAthlete } from '@/lib/coachService';
import { formatDateTime, formatDuration, promptExport } from '@/lib/exportReport';
import { maskName } from '@/lib/privacy';
import { clearIdentityCache, getCurrentCoachRecord, getUpcomingSessions } from '@/lib/sessionService';
import { supabase } from '@/lib/supabase';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  BackHandler,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
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

type CoachSection = 'personal' | 'team' | 'account';

const SECTION_TITLES: Record<CoachSection, string> = {
  personal: 'Personal information',
  team: 'Team data',
  account: 'Settings',
};

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

  const [savingProfile, setSavingProfile] = useState(false);
  const [inlineFields, setInlineFields] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    username: '',
  });
  const [pwVisible, setPwVisible] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [section, setSection] = useState<CoachSection | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Hardware back returns from a section page to the profile menu.
  useEffect(() => {
    if (section === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSection(null);
      return true;
    });
    return () => sub.remove();
  }, [section]);

  // Pre-populate inline fields whenever the personal section is opened.
  useEffect(() => {
    if (section === 'personal') {
      setInlineFields({
        firstName: profile.firstName,
        middleName: profile.middleName,
        lastName: profile.lastName,
        username: profile.username,
      });
    }
  }, [section]);

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
          setUserId(user.id);
          getProfilePhotoUrl(user.id).then(setPhotoUrl);
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
          await clearCoachLogin();
          await supabase.auth.signOut();
          router.replace('/');
        },
      },
    ]);
  };

  const handleSaveProfile = async () => {
    const f = {
      firstName: inlineFields.firstName.trim(),
      middleName: inlineFields.middleName.trim(),
      lastName: inlineFields.lastName.trim(),
      username: inlineFields.username.trim(),
    };
    if (!f.firstName || !f.lastName || !f.username) {
      Alert.alert('Missing details', 'First name, last name and username are required.');
      return;
    }
    setSavingProfile(true);
    try {
      if (coachId != null) {
        // The table keeps masked names; Auth (below) keeps the real ones
        const { error } = await supabase
          .from('tbl_coaches')
          .update({
            ...f,
            firstName: maskName(f.firstName),
            middleName: maskName(f.middleName),
            lastName: maskName(f.lastName),
          })
          .eq('id', coachId);
        if (error) throw error;
      }
      const { error: authError } = await supabase.auth.updateUser({ data: f });
      if (authError) throw authError;
      clearIdentityCache();
      setProfile((prev) => ({ ...prev, ...f }));
      Alert.alert('Saved', 'Your profile has been updated.');
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
      const [metricsRes, athletesRes, jerseys] = await Promise.all([
        supabase
          .from('tbl_session_metrics')
          .select('*')
          .order('completed_at', { ascending: false }),
        supabase.from('tbl_athletes').select('id, firstName, lastName, username'),
        getJerseyNumbersByAthlete(),
      ]);
      if (metricsRes.error) throw metricsRes.error;
      const metrics = metricsRes.data ?? [];
      if (metrics.length === 0) {
        Alert.alert('Nothing to export', 'No athlete sessions have been recorded yet.');
        return;
      }

      const names: Record<string, string> = {};
      (athletesRes.data ?? []).forEach((a: any) => {
        names[String(a.id)] =
          `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.username || `Athlete ${a.id}`;
      });

      const athleteCount = new Set(metrics.map((m: any) => m.athlete_id)).size;
      const totalLoad = metrics.reduce((s: number, m: any) => s + (Number(m.player_load_au) || 0), 0);
      const first = formatDateTime(metrics[metrics.length - 1].completed_at);
      const last = formatDateTime(metrics[0].completed_at);

      // promptExport handles its own busy state from here
      setExporting(false);
      promptExport(
        {
          title: 'Team session report',
          fileName: 'SmartAthlete_team_report',
          subtitle: [`${first} – ${last}`],
          summary: [
            { label: 'Athletes', value: String(athleteCount) },
            { label: 'Sessions', value: String(metrics.length) },
            { label: 'Total load', value: `${Math.round(totalLoad)} AU` },
            { label: 'Avg load / session', value: `${Math.round(totalLoad / metrics.length)} AU` },
          ],
          rows: metrics as any[],
          columns: [
            { label: '#', value: (m) => (jerseys.get(Number(m.athlete_id)) ? `#${jerseys.get(Number(m.athlete_id))}` : '') },
            { label: 'Athlete', value: (m) => names[String(m.athlete_id)] ?? `Athlete ${m.athlete_id}` },
            { label: 'Date', value: (m) => formatDateTime(m.completed_at) },
            { label: 'Session', value: (m) => m.session_title },
            { label: 'Duration', value: (m) => formatDuration(m.total_seconds) },
            { label: 'Load (AU)', value: (m) => Math.round(Number(m.player_load_au) || 0), numeric: true },
            { label: 'RPE', value: (m) => (m.session_rpe != null ? m.session_rpe : ''), numeric: true },
            { label: 'Steps', value: (m) => m.steps, numeric: true },
            { label: 'Distance (m)', value: (m) => Math.round(Number(m.meters) || 0), numeric: true },
            { label: 'Jumps', value: (m) => m.jumps, numeric: true },
            { label: 'Avg HR', value: (m) => m.avg_heart_rate || '', numeric: true },
            { label: 'Max HR', value: (m) => m.max_heart_rate || '', numeric: true },
            { label: 'Calories', value: (m) => m.calories_burned, numeric: true },
          ],
        },
        setExporting
      );
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
        {section === null ? (
          <>
            <Text variant="headlineLarge" style={[styles.title, { color: theme.colors.onBackground }]}>
              Profile
            </Text>

            {/* ─── Profile Card ─── */}
            <Card
              mode="contained"
              style={[styles.profileCard, { backgroundColor: theme.colors.primaryContainer }]}
            >
              <Card.Content style={styles.profileCardContent}>
                <ProfileAvatar
                  userId={userId}
                  initials={initials}
                  photoUrl={photoUrl}
                  onChange={setPhotoUrl}
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
                  icon="cog-outline"
                  mode="contained-tonal"
                  onPress={() => setSection('account')}
                  accessibilityLabel="Settings"
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

            {/* ─── Section menu ─── */}
            <MenuGroup>
              <MenuRow
                icon="account-outline"
                title="Personal information"
                subtitle="Name, email, birthdate and gender"
                onPress={() => setSection('personal')}
              />
            </MenuGroup>

            <MenuGroup label="Team">
              <MenuRow
                icon="download-outline"
                title="Team data"
                subtitle="Export athlete session report"
                onPress={() => setSection('team')}
              />
            </MenuGroup>

            <AppearanceSelector />

            <Text
              variant="labelSmall"
              style={[styles.versionText, { color: theme.colors.onSurfaceVariant }]}
            >
              SmartAthlete v{Constants.expoConfig?.version ?? '1.0.0'}
            </Text>
          </>
        ) : (
          <SectionHeader title={SECTION_TITLES[section]} onBack={() => setSection(null)} />
        )}

        {/* ─── Personal Information — inline editable ─── */}
        {/* {section === 'personal' && (
        <Card
          mode="elevated"
          style={[styles.sectionCard, { backgroundColor: theme.colors.elevation.level1 }]}
        >
          <Card.Content style={{ gap: 12 }}>
            <Text variant="titleSmall" style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
              Personal information
            </Text>

            <TextInput
              mode="outlined"
              label="First name"
              value={inlineFields.firstName}
              onChangeText={(v) => setInlineFields((f) => ({ ...f, firstName: v }))}
            />
            <TextInput
              mode="outlined"
              label="Middle name (optional)"
              value={inlineFields.middleName}
              onChangeText={(v) => setInlineFields((f) => ({ ...f, middleName: v }))}
            />
            <TextInput
              mode="outlined"
              label="Last name"
              value={inlineFields.lastName}
              onChangeText={(v) => setInlineFields((f) => ({ ...f, lastName: v }))}
            />
            <TextInput
              mode="outlined"
              label="Username"
              autoCapitalize="none"
              value={inlineFields.username}
              onChangeText={(v) => setInlineFields((f) => ({ ...f, username: v }))}
            />

            <Divider />

            <List.Item
              title="Email"
              description={email || '--'}
              descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
              left={(p) => <List.Icon {...p} icon="email-outline" />}
              style={{ paddingHorizontal: 0 }}
            />
            <List.Item
              title="Birthdate"
              description={formatBirthdate(profile.birthdate)}
              descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
              left={(p) => <List.Icon {...p} icon="cake-variant-outline" />}
              style={{ paddingHorizontal: 0 }}
            />
            <List.Item
              title="Gender"
              description={profile.gender || 'Not set'}
              descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
              left={(p) => <List.Icon {...p} icon="account-outline" />}
              style={{ paddingHorizontal: 0 }}
            />

            <Button
              mode="contained"
              loading={savingProfile}
              disabled={savingProfile}
              onPress={handleSaveProfile}
              style={{ borderRadius: 12, marginTop: 4 }}
            >
              Save changes
            </Button>
          </Card.Content>
        </Card>
        )} */}

        {/* ─── Personal Information — tap the pencil to edit ─── */}
        {section === 'personal' && (
          <PersonalInfoCard
            table="tbl_coaches"
            recordId={coachId}
            email={email}
            profile={profile}
            onProfileChange={(updates) => setProfile((p) => ({ ...p, ...updates }))}
            onEmailChange={setEmail}
          />
        )}

        {/* ─── Team Data ─── */}
        {section === 'team' && (
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
        )}

        {/* ─── Account ─── */}
        {section === 'account' && (
          <Card
            mode="elevated"
            style={[styles.sectionCard, { backgroundColor: theme.colors.elevation.level1 }]}
          >
            <Card.Content style={styles.listCardContent}>
              <Text variant="titleSmall" style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
                Account settings
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
        )}
      </ScrollView>

      <Portal>
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