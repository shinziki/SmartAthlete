import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Avatar, Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const theme = useTheme();
  const router = useRouter();

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
