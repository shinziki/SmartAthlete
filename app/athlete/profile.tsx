import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Alert, RefreshControl } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  Portal,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { DeviceLink, getActiveDeviceLink, unlinkWatchDevice } from '@/lib/deviceLink';
import { requestUnlinkFromWatch } from '@/lib/ble-manager';

// ─── Helpers ─────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ─── Privacy Setting Row ─────────────────────────────────────

function PrivacyRow({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={privacyStyles.row}>
      <Text
        variant="bodyMedium"
        style={[privacyStyles.label, { color: theme.colors.onSurface }]}
      >
        {label}
      </Text>
      <Chip
        compact
        style={{
          backgroundColor: enabled
            ? theme.colors.primaryContainer
            : theme.colors.surfaceVariant,
        }}
        textStyle={{
          color: enabled
            ? theme.colors.primary
            : theme.colors.onSurfaceVariant,
          fontSize: 12,
          fontWeight: '600',
        }}
      >
        {enabled ? 'On' : 'Off'}
      </Chip>
    </View>
  );
}

const privacyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  label: {
    flex: 1,
    marginRight: 12,
  },
});

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

  const loadAthleteData = useCallback(async (isPullToRefresh = false) => {
    try {
      if (isPullToRefresh) {
        setRefreshing(true);
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/athlete-sign-in' as any);
        return;
      }

      setAthleteEmail(user.email ?? 'Athlete');
      // Build full name from firstName + lastName stored during registration
      const meta = user.user_metadata;
      const first = meta?.firstName ?? '';
      const last = meta?.lastName ?? '';
      const fullName = `${first} ${last}`.trim();
      setAthleteName(fullName || user.email?.split('@')[0] || 'Athlete');

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
    router.replace('/athlete-sign-in' as any);
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
          style={[
            styles.profileCard,
            { backgroundColor: theme.colors.primaryContainer },
          ]}
        >
          <Card.Content style={styles.profileCardContent}>
            <Avatar.Text
              size={56}
              label={initials}
              style={{ backgroundColor: theme.colors.primary }}
              color={theme.colors.onPrimary}
              labelStyle={{ fontWeight: '700', fontSize: 20 }}
            />
            <View style={styles.profileTextGroup}>
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700' }}
              >
                {athleteName}
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                Guard · #7 · Men's Basketball
              </Text>
            </View>
          </Card.Content>
        </Card>

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
                    ? `${deviceLink.watch_name || 'Wear OS Device'}${
                        deviceLink.watch_node_id
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

        {/* ─── Consent Status Card ─── */}
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
                  Consent status
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                >
                  Informed consent on file
                </Text>
              </View>
              <Chip
                compact
                style={{ backgroundColor: theme.colors.primaryContainer }}
                textStyle={{
                  color: theme.colors.primary,
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                Signed
              </Chip>
            </View>
          </Card.Content>
        </Card>

        {/* ─── Privacy Settings Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.sectionCard,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content>
            <Text
              variant="titleSmall"
              style={{
                color: theme.colors.onSurface,
                fontWeight: '700',
                marginBottom: 4,
              }}
            >
              Privacy settings
            </Text>

            <PrivacyRow
              label="Data recorded during team sessions only"
              enabled={true}
            />
            <Divider />
            <PrivacyRow
              label="Only you and your coach see your data"
              enabled={true}
            />
            <Divider />
            <PrivacyRow label="Protected under RA 10173" enabled={true} />
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
              'Are you sure you want to withdraw? This action cannot be undone.',
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
