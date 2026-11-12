import AppearanceSelector from '@/components/profile/AppearanceSelector';
import PersonalInfoCard from '@/components/profile/PersonalInfoCard';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import { MenuGroup, MenuRow, SectionHeader } from '@/components/profile/ProfileMenu';
import { requestUnlinkFromWatch } from '@/lib/ble-manager';
import { DeviceLink, getActiveDeviceLink, unlinkWatchDevice } from '@/lib/deviceLink';
import { getProfilePhotoUrl } from '@/lib/profilePhoto';
import {
  SessionMetricRecord,
  fetchAthleteSessionHistory,
  getCurrentAthleteRecord,
  invalidateAthleteRecordCache,
  athleteLabel,
} from '@/lib/sessionService';
import { formatDateTime, formatDuration, promptExport } from '@/lib/exportReport';
import { maskName } from '@/lib/privacy';
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
  ActivityIndicator,
  Button,
  Card,
  Chip,
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

// ─── Helpers ─────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

type ProfileSection = 'personal' | 'device' | 'account' | 'privacy';

const SECTION_TITLES: Record<ProfileSection, string> = {
  personal: 'Personal information',
  device: 'Assigned device',
  account: 'Settings',
  privacy: 'Privacy and data',
};

// ─── Profile data ────────────────────────────────────────────

interface ProfileData {
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

// ─── Main Screen ─────────────────────────────────────────────

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [athleteName, setAthleteName] = useState<string>('Athlete');
  const [athleteEmail, setAthleteEmail] = useState<string | null>(null);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkStatus, setUnlinkStatus] = useState('');
  const [athleteId, setAthleteId] = useState<number | null>(null);
  const [jerseyNumber, setJerseyNumber] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData>({
    firstName: '',
    middleName: '',
    lastName: '',
    username: '',
    birthdate: '',
    gender: '',
  });
  const [history, setHistory] = useState<SessionMetricRecord[]>([]);
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
  const [section, setSection] = useState<ProfileSection | null>(null);
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

  const loadAthleteData = useCallback(async (isPullToRefresh = false) => {
    try {
      if (isPullToRefresh) {
        setRefreshing(true);
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/' as any);
        return;
      }

      setAthleteEmail(user.email ?? 'Athlete');
      setUserId(user.id);
      setPhotoUrl(await getProfilePhotoUrl(user.id));
      // Build full name from firstName + lastName stored during registration
      const meta = user.user_metadata;
      const first = meta?.firstName ?? '';
      const last = meta?.lastName ?? '';
      const fullName = `${first} ${last}`.trim();
      setAthleteName(fullName || user.email?.split('@')[0] || 'Athlete');

      // const link = await getActiveDeviceLink(user.id);
      // setDeviceLink(link);
      setProfile({
        firstName: meta?.firstName ?? '',
        middleName: meta?.middleName ?? '',
        lastName: meta?.lastName ?? '',
        username: meta?.username ?? '',
        birthdate: meta?.birthdate ?? '',
        gender: meta?.gender ?? '',
      });

      const athlete = await getCurrentAthleteRecord();
      setAthleteId(athlete?.id ?? null);
      setJerseyNumber(athlete?.jerseyNumber ?? null);
      const historyRes = await fetchAthleteSessionHistory(athlete?.id);
      setHistory(historyRes.data);

      const link = await getActiveDeviceLink(user.id);
      setDeviceLink(link);
    } catch (err) {
      console.error('Failed to load athlete data:', err);
    } finally {
      setLoading(false);
      if (isPullToRefresh) {
        setRefreshing(false);
      }
    }
  }, [router]);

  // Automatically refresh athlete data and device link whenever this tab/screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadAthleteData(false);
    }, [loadAthleteData])
  );

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    invalidateAthleteRecordCache();
    router.replace('/' as any);
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: handleSignOut },
    ]);

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
      if (athleteId != null) {
        // The table keeps masked names; Auth (below) keeps the real ones
        const { error } = await supabase
          .from('tbl_athletes')
          .update({
            ...f,
            firstName: maskName(f.firstName),
            middleName: maskName(f.middleName),
            lastName: maskName(f.lastName),
          })
          .eq('id', athleteId);
        if (error) throw error;
      }
      const { error: authError } = await supabase.auth.updateUser({ data: f });
      if (authError) throw authError;
      clearIdentityCache();
      invalidateAthleteRecordCache();
      setProfile((prev) => ({ ...prev, ...f }));
      setAthleteName(`${f.firstName} ${f.lastName}`.trim());
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

  const handleExportData = () => {
    if (history.length === 0) {
      Alert.alert('Nothing to export', 'Complete a tracked session first.');
      return;
    }
    const sorted = [...history].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
    const totalSeconds = sorted.reduce((s, r) => s + (r.totalSeconds || 0), 0);
    const totalLoad = sorted.reduce((s, r) => s + (r.playerLoadAU || 0), 0);
    const totalMeters = sorted.reduce((s, r) => s + (r.meters || 0), 0);
    const totalJumps = sorted.reduce((s, r) => s + (r.jumps || 0), 0);
    const first = formatDateTime(sorted[sorted.length - 1].completedAt);
    const last = formatDateTime(sorted[0].completedAt);

    promptExport(
      {
        title: 'My training sessions',
        fileName: 'SmartAthlete_my_sessions',
        subtitle: [
          `${athleteName}${jerseyNumber ? ` · #${jerseyNumber}` : ''}`,
          `${first} – ${last}`,
        ],
        summary: [
          { label: 'Sessions', value: String(sorted.length) },
          { label: 'Total time', value: formatDuration(totalSeconds) },
          { label: 'Total load', value: `${Math.round(totalLoad)} AU` },
          { label: 'Avg load', value: `${Math.round(totalLoad / sorted.length)} AU` },
          { label: 'Distance', value: `${(totalMeters / 1000).toFixed(2)} km` },
          { label: 'Jumps', value: String(totalJumps) },
        ],
        rows: sorted,
        columns: [
          { label: 'Date', value: (r) => formatDateTime(r.completedAt) },
          { label: 'Session', value: (r) => r.sessionTitle },
          { label: 'Duration', value: (r) => formatDuration(r.totalSeconds) },
          { label: 'Load (AU)', value: (r) => Math.round(r.playerLoadAU || 0), numeric: true },
          { label: 'RPE', value: (r) => (r.sessionRpe != null ? r.sessionRpe : ''), numeric: true },
          { label: 'Steps', value: (r) => r.steps, numeric: true },
          { label: 'Distance (m)', value: (r) => Math.round(r.meters || 0), numeric: true },
          { label: 'Jumps', value: (r) => r.jumps, numeric: true },
          { label: 'Avg HR', value: (r) => r.avgHeartRate || '', numeric: true },
          { label: 'Max HR', value: (r) => r.maxHeartRate || '', numeric: true },
          { label: 'Calories', value: (r) => r.caloriesBurned, numeric: true },
          { label: 'Watch', value: (r) => r.watchName },
        ],
      },
      setExporting
    );
  };

  const handleUnlink = () => {
    if (!deviceLink) return;

    Alert.alert(
      'Unlink Smartwatch',
      'This will send an unlinking request to your Wear OS watch. You will be prompted to confirm on the watch.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            setUnlinking(true);
            setUnlinkStatus('Connecting to your watch…');

            try {
              const result = await requestUnlinkFromWatch(
                deviceLink.watch_node_id,
                'Athlete App',
                (status) => setUnlinkStatus(status)
              );

              setUnlinking(false);

              if (result === 'ACCEPTED') {
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (user) {
                  await unlinkWatchDevice(user.id);
                }
                setDeviceLink(null);

                Alert.alert(
                  'Smartwatch Unlinked',
                  'The watch confirmed the unlink request. Both devices are now unlinked.'
                );
              } else {
                Alert.alert(
                  'Unlink Cancelled',
                  'The unlink request was cancelled or declined on your watch. The watch remains linked.'
                );
              }
            } catch (err: any) {
              setUnlinking(false);
              Alert.alert(
                'Watch Not Responding',
                `${err.message || 'Could not communicate with the watch.'}\n\nWould you like to unlink on this phone anyway?`,
                [
                  { text: 'Keep Linked', style: 'cancel' },
                  {
                    text: 'Unlink Anyway',
                    style: 'destructive',
                    onPress: async () => {
                      const {
                        data: { user },
                      } = await supabase.auth.getUser();
                      if (user) {
                        await unlinkWatchDevice(user.id);
                      }
                      setDeviceLink(null);
                    },
                  },
                ]
              );
            }
          },
        },
      ]
    );
  };

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
  const totalLoad = Math.round(history.reduce((sum, r) => sum + r.playerLoadAU, 0));
  const totalJumps = history.reduce((sum, r) => sum + r.jumps, 0);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAthleteData(true)}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        {section === null ? (
          <>
            {/* ─── Page Title ─── */}
            <Text
              variant="headlineLarge"
              style={[styles.pageTitle, { color: theme.colors.onBackground }]}
            >
              My Profile
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
                    {athleteName}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
                    {profile.username ? `@${profile.username}` : athleteEmail}
                  </Text>
                  {athleteId != null && (
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onPrimaryContainer, fontWeight: '600' }}
                    >
                      {athleteLabel({ id: athleteId, jerseyNumber })}
                    </Text>
                  )}
                </View>
                <IconButton
                  icon="cog-outline"
                  mode="contained-tonal"
                  onPress={() => setSection('account')}
                  accessibilityLabel="Settings"
                />
              </Card.Content>
            </Card>

            {/* ─── Training Summary ─── */}
            <View style={styles.statsRow}>
              {[
                { label: 'Sessions', value: String(history.length), unit: '' },
                { label: 'Total load', value: totalLoad.toLocaleString(), unit: 'AU' },
                { label: 'Jumps', value: totalJumps.toLocaleString(), unit: '' },
              ].map((stat) => (
                <View
                  key={stat.label}
                  style={[styles.statTile, { backgroundColor: theme.colors.surfaceVariant }]}
                >
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {stat.label}
                  </Text>
                  <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '800' }}>
                    {stat.value}
                    {stat.unit ? (
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {' '}
                        {stat.unit}
                      </Text>
                    ) : null}
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

            <MenuGroup label="Device">
              <MenuRow
                icon="watch"
                title="Assigned device"
                subtitle={deviceLink ? deviceLink.watch_name || 'Wear OS Device' : 'No device linked'}
                onPress={() => setSection('device')}
              />
            </MenuGroup>

            <MenuGroup label="Privacy">
              <MenuRow
                icon="shield-check-outline"
                title="Privacy and data"
                subtitle="How your data is used, export"
                onPress={() => setSection('privacy')}
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

        {section === 'device' && (
          <Card
            mode="elevated"
            style={[
              styles.sectionCard,
              { backgroundColor: theme.colors.elevation.level1 },
            ]}
          >
            <Card.Content style={styles.sectionCardContent}>
              <View style={styles.sectionRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    variant="titleSmall"
                    style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                  >
                    Assigned device
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    {deviceLink
                      ? `${deviceLink.watch_name || 'Wear OS Device'}${deviceLink.watch_node_id
                        ? ` · ${deviceLink.watch_node_id}`
                        : ''
                      }`
                      : 'No device linked'}
                  </Text>
                </View>
                <Chip
                  compact
                  style={{
                    backgroundColor: deviceLink
                      ? theme.colors.primaryContainer
                      : theme.colors.errorContainer,
                  }}
                  textStyle={{
                    color: deviceLink
                      ? theme.colors.primary
                      : theme.colors.error,
                    fontSize: 12,
                    fontWeight: '600',
                  }}
                >
                  {deviceLink ? 'Linked' : 'None'}
                </Chip>
              </View>

              {/* Smartwatch actions */}
              {deviceLink ? (
                <View style={styles.deviceActions}>
                  <Button
                    mode="outlined"
                    compact
                    icon="refresh"
                    onPress={() => router.push('/athlete/smartwatch-setup' as any)}
                    style={styles.deviceActionButton}
                  >
                    Re-pair
                  </Button>
                  <Button
                    mode="text"
                    compact
                    textColor={theme.colors.error}
                    icon="link-off"
                    onPress={handleUnlink}
                    disabled={unlinking}
                    style={styles.deviceActionButton}
                  >
                    Unlink
                  </Button>
                </View>
              ) : (
                <Button
                  mode="contained"
                  icon="watch"
                  onPress={() => router.push('/athlete/smartwatch-setup' as any)}
                  style={styles.linkWatchButton}
                >
                  Link Wear OS Watch
                </Button>
              )}
            </Card.Content>
          </Card>
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
              description={athleteEmail ?? '--'}
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
            table="tbl_athletes"
            recordId={athleteId}
            email={athleteEmail ?? ''}
            profile={profile}
            onProfileChange={(updates) => {
              const next = { ...profile, ...updates };
              setProfile(next);
              setAthleteName(`${next.firstName} ${next.lastName}`.trim());
            }}
            onEmailChange={setAthleteEmail}
          />
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
                left={(p) => <List.Icon {...p} icon="logout" />}
                onPress={confirmSignOut}
              />
            </Card.Content>
          </Card>
        )}

        {/* ─── Privacy & Data ─── */}
        {section === 'privacy' && (
          <Card
            mode="elevated"
            style={[styles.sectionCard, { backgroundColor: theme.colors.elevation.level1 }]}
          >
            <Card.Content style={styles.listCardContent}>
              <Text variant="titleSmall" style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
                Privacy and data
              </Text>
              {[
                'Data recorded during team sessions only',
                'Only you and your coach see your data',
                'Protected under RA 10173',
              ].map((line) => (
                <List.Item
                  key={line}
                  title={line}
                  titleNumberOfLines={2}
                  left={(p) => <List.Icon {...p} icon="check-circle-outline" />}
                />
              ))}
              <Button
                mode="outlined"
                icon="download-outline"
                onPress={handleExportData}
                loading={exporting}
                disabled={exporting}
                style={styles.exportButton}
              >
                Export my data
              </Button>
            </Card.Content>
          </Card>
        )}

        {/* ─── Withdraw Participation ─── */}
        {section === 'account' && (
          <Button
            mode="outlined"
            style={[
              styles.withdrawButton,
              { borderColor: theme.colors.outlineVariant },
            ]}
            textColor={theme.colors.onSurfaceVariant}
            contentStyle={styles.withdrawButtonContent}
            labelStyle={{ fontWeight: '600' }}
            onPress={() =>
              Alert.alert(
                'Withdraw Participation',
                'This signs you out on this phone. Your recorded sessions stay in the system until your coach removes them.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Withdraw',
                    style: 'destructive',
                    onPress: handleSignOut,
                  },
                ]
              )
            }
          >
            Withdraw participation
          </Button>
        )}
      </ScrollView>

      {/* ─── Unlinking Modal Dialog ─── */}
      <Portal>
        <Dialog
          visible={unlinking}
          dismissable={false}
          style={[
            styles.dialog,
            { backgroundColor: theme.colors.elevation.level3 },
          ]}
        >
          <Dialog.Title style={{ color: theme.colors.onSurface }}>
            Unlinking Smartwatch
          </Dialog.Title>
          <Dialog.Content>
            <View style={styles.dialogContent}>
              <ActivityIndicator
                size="large"
                color={theme.colors.primary}
                style={styles.dialogSpinner}
              />
              <Text
                variant="bodyMedium"
                style={{
                  color: theme.colors.onSurface,
                  textAlign: 'center',
                  fontWeight: '600',
                }}
              >
                {unlinkStatus}
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  color: theme.colors.onSurfaceVariant,
                  textAlign: 'center',
                  marginTop: 8,
                }}
              >
                Please confirm or decline the request on your Wear OS watch screen.
              </Text>
            </View>
          </Dialog.Content>
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
  pageTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },

  // Profile card
  profileCard: {
    borderRadius: 20,
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

  // Section cards
  sectionCard: {
    borderRadius: 20,
  },
  sectionCardContent: {
    gap: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },

  // Device actions
  deviceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  deviceActionButton: {
    borderRadius: 20,
  },
  linkWatchButton: {
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginTop: 4,
  },

  // Training summary
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

  // List cards
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
  dialogInput: {
    marginBottom: 10,
  },

  // Withdraw button
  withdrawButton: {
    borderRadius: 16,
    marginTop: 4,
  },
  withdrawButtonContent: {
    height: 52,
  },

  // Dialog
  dialog: {
    borderRadius: 20,
    paddingVertical: 8,
  },
  dialogContent: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  dialogSpinner: {
    marginBottom: 16,
  },
});
