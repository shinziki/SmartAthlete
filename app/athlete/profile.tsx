import { requestUnlinkFromWatch } from '@/lib/ble-manager';
import { DeviceLink, getActiveDeviceLink, unlinkWatchDevice } from '@/lib/deviceLink';
import {
  SessionMetricRecord,
  fetchAthleteSessionHistory,
  getCurrentAthleteRecord,
} from '@/lib/sessionService';
import { supabase } from '@/lib/supabase';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
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
  const [profile, setProfile] = useState<ProfileData>({
    firstName: '',
    middleName: '',
    lastName: '',
    username: '',
    birthdate: '',
    gender: '',
  });
  const [history, setHistory] = useState<SessionMetricRecord[]>([]);
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
    router.replace('/' as any);
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: handleSignOut },
    ]);

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
      if (athleteId != null) {
        const { error } = await supabase.from('tbl_athletes').update(f).eq('id', athleteId);
        if (error) throw error;
      }
      const { error: authError } = await supabase.auth.updateUser({ data: f });
      if (authError) throw authError;
      setProfile((prev) => ({ ...prev, ...f }));
      setAthleteName(`${f.firstName} ${f.lastName}`.trim());
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

  const handleExportData = async () => {
    if (history.length === 0) {
      Alert.alert('Nothing to export', 'Complete a tracked session first.');
      return;
    }
    const header =
      'date,title,duration_seconds,load_au,steps,meters,jumps,avg_heart_rate,max_heart_rate,calories';
    const rows = history.map((r) =>
      [
        new Date(r.completedAt).toISOString(),
        `"${r.sessionTitle.replace(/"/g, '""')}"`,
        r.totalSeconds,
        r.playerLoadAU,
        r.steps,
        r.meters,
        r.jumps,
        r.avgHeartRate,
        r.maxHeartRate,
        r.caloriesBurned,
      ].join(',')
    );
    await Share.share({ title: 'SmartAthlete session data', message: [header, ...rows].join('\n') });
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
                  Athlete ID #{athleteId}
                </Text>
              )}
            </View>
            <IconButton
              icon="pencil-outline"
              mode="contained-tonal"
              onPress={openEditProfile}
              accessibilityLabel="Edit profile"
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

        {/* ─── Assigned Device Card ─── */}
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
              description={athleteEmail ?? '--'}
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
              left={(p) => <List.Icon {...p} icon="logout" />}
              onPress={confirmSignOut}
            />
          </Card.Content>
        </Card>

        {/* ─── Privacy & Data ─── */}
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
              style={styles.exportButton}
            >
              Export my data
            </Button>
          </Card.Content>
        </Card>

        {/* ─── Withdraw Participation ─── */}
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
        <Text
          variant="labelSmall"
          style={[styles.versionText, { color: theme.colors.onSurfaceVariant }]}
        >
          SmartAthlete v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
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
