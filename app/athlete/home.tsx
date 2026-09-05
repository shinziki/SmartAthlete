import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Alert } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { DeviceLink, getActiveDeviceLink, unlinkWatchDevice } from '@/lib/deviceLink';

export default function AthleteHomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [athleteEmail, setAthleteEmail] = useState<string | null>(null);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadAthleteData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/athlete-sign-in' as any);
          return;
        }

        if (!cancelled) {
          setAthleteEmail(user.email ?? 'Athlete');
        }

        const link = await getActiveDeviceLink(user.id);
        if (!cancelled) {
          setDeviceLink(link);
        }
      } catch (err) {
        console.error('Failed to load athlete data:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadAthleteData();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/athlete-sign-in' as any);
  };

  const handleUnlink = () => {
    Alert.alert(
      'Unlink Smartwatch',
      'Are you sure you want to unlink your Wear OS watch? You will be prompted to pair again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await unlinkWatchDevice(user.id);
              setDeviceLink(null);
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
            <Avatar.Icon
              size={48}
              icon="account"
              style={{ backgroundColor: theme.colors.primaryContainer }}
              color={theme.colors.primary}
            />
            <View style={styles.welcomeTextGroup}>
              <Text
                variant="titleMedium"
                style={[styles.welcomeTitle, { color: theme.colors.onBackground }]}
              >
                Welcome Back
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
                numberOfLines={1}
              >
                {athleteEmail ?? 'Loading...'}
              </Text>
            </View>
          </View>
          <IconButton
            icon="logout"
            mode="contained-tonal"
            size={20}
            onPress={handleSignOut}
          />
        </View>

        <Divider style={styles.divider} />

        {/* ─── Smartwatch Status Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.card,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderTitle}>
                <Avatar.Icon
                  size={36}
                  icon="watch"
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  color={theme.colors.primary}
                />
                <Text
                  variant="titleMedium"
                  style={[styles.cardTitle, { color: theme.colors.onSurface }]}
                >
                  Smartwatch Device
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
                  fontWeight: 'bold',
                }}
              >
                {deviceLink ? 'Linked' : 'Not Linked'}
              </Chip>
            </View>

            {deviceLink ? (
              <View style={styles.deviceDetails}>
                <Text
                  variant="bodyMedium"
                  style={{ fontWeight: 'bold', color: theme.colors.onSurface }}
                >
                  {deviceLink.watch_name || 'Wear OS Device'}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Node ID: {deviceLink.watch_node_id}
                </Text>
                {deviceLink.paired_at && (
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.outline, marginTop: 4 }}
                  >
                    Paired:{' '}
                    {new Date(deviceLink.paired_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                )}
                <View style={styles.buttonRow}>
                  <Button
                    mode="outlined"
                    icon="refresh"
                    onPress={() => router.push('/athlete/smartwatch-setup' as any)}
                    style={styles.relinkButton}
                  >
                    Re-pair
                  </Button>
                  <Button
                    mode="text"
                    textColor={theme.colors.error}
                    icon="link-off"
                    onPress={handleUnlink}
                    style={styles.unlinkButton}
                  >
                    Unlink
                  </Button>
                </View>
              </View>
            ) : (
              <View style={styles.noDeviceDetails}>
                <Text
                  variant="bodyMedium"
                  style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}
                >
                  No smartwatch is currently linked to your athlete account.
                </Text>
                <Button
                  mode="contained"
                  icon="watch"
                  onPress={() => router.push('/athlete/smartwatch-setup' as any)}
                  style={styles.linkButton}
                >
                  Link Wear OS Watch
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* ─── Training / Session Placeholder ─── */}
        <Card
          mode="elevated"
          style={[
            styles.card,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderTitle}>
                <Avatar.Icon
                  size={36}
                  icon="run-fast"
                  style={{ backgroundColor: theme.colors.secondaryContainer }}
                  color={theme.colors.secondary}
                />
                <Text
                  variant="titleMedium"
                  style={[styles.cardTitle, { color: theme.colors.onSurface }]}
                >
                  Training Session
                </Text>
              </View>
            </View>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
            >
              When a training session starts on your Wear OS watch, real-time telemetry
              and metrics will appear here.
            </Text>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

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
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  welcomeTextGroup: {
    flex: 1,
  },
  welcomeTitle: {
    fontWeight: 'bold',
  },
  divider: {
    marginVertical: 4,
  },
  card: {
    borderRadius: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardTitle: {
    fontWeight: 'bold',
  },
  deviceDetails: {
    marginTop: 14,
    gap: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  relinkButton: {
    borderRadius: 20,
  },
  unlinkButton: {
    borderRadius: 20,
  },
  noDeviceDetails: {
    marginTop: 14,
  },
  linkButton: {
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
});
