import { supabase } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ResetPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const initialUrl = Linking.useURL();

  const [sessionReady, setSessionReady] = useState(false);
  const [verifyingSession, setVerifyingSession] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'Athlete' | 'Coach' | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [secureConfirmTextEntry, setSecureConfirmTextEntry] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  // Helper to extract parameters from URL hash or query
  const extractParamsFromUrl = (url: string) => {
    const params: Record<string, string> = {};

    // Check query string
    if (url.includes('?')) {
      const queryString = url.split('?')[1].split('#')[0];
      queryString.split('&').forEach((pair) => {
        const [key, value] = pair.split('=');
        if (key && value) params[key] = decodeURIComponent(value);
      });
    }

    // Check hash fragment
    if (url.includes('#')) {
      const hashString = url.split('#')[1];
      hashString.split('&').forEach((pair) => {
        const [key, value] = pair.split('=');
        if (key && value) params[key] = decodeURIComponent(value);
      });
    }

    return params;
  };

  const initRecoverySession = async (urlToProcess?: string | null) => {
    try {
      setVerifyingSession(true);

      // 1. First check if Supabase already has an active session (e.g. from deep link handler)
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();

      if (existingSession?.user) {
        setUserEmail(existingSession.user.email ?? null);
        await determineUserRole(existingSession.user.email ?? '');
        setSessionReady(true);
        setVerifyingSession(false);
        return;
      }

      // 2. If no existing session, parse tokens from incoming deep link URL
      const currentUrl = urlToProcess || (await Linking.getInitialURL());

      if (currentUrl) {
        const params = extractParamsFromUrl(currentUrl);

        // Handle PKCE code
        if (params.code) {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(params.code);
          if (!exchangeError && data.session) {
            setUserEmail(data.session.user.email ?? null);
            await determineUserRole(data.session.user.email ?? '');
            setSessionReady(true);
            setVerifyingSession(false);
            return;
          }
        }

        // Handle access_token & refresh_token from hash
        if (params.access_token && params.refresh_token) {
          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });

          if (!setSessionError && data.session) {
            setUserEmail(data.session.user.email ?? null);
            await determineUserRole(data.session.user.email ?? '');
            setSessionReady(true);
            setVerifyingSession(false);
            return;
          }
        }
      }

      // If we reach here, we couldn't establish a recovery session
      setSessionReady(false);
    } catch (err: any) {
      console.error('Error initializing recovery session:', err);
      setSessionReady(false);
    } finally {
      setVerifyingSession(false);
    }
  };

  const determineUserRole = async (email: string) => {
    if (!email) return;
    try {
      // Check coach table first
      const { data: coachData } = await supabase
        .from('tbl_coaches')
        .select('role')
        .ilike('email', email)
        .maybeSingle();

      if (coachData) {
        setUserRole('Coach');
        return;
      }

      // Check athlete table
      const { data: athleteData } = await supabase
        .from('tbl_athletes')
        .select('role')
        .ilike('email', email)
        .maybeSingle();

      if (athleteData) {
        setUserRole('Athlete');
        return;
      }
    } catch (err) {
      console.warn('Error determining role:', err);
    }
  };

  useEffect(() => {
    initRecoverySession(initialUrl);

    // Listen for auth state change
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (session?.user && !sessionReady)) {
          setUserEmail(session?.user?.email ?? null);
          if (session?.user?.email) {
            await determineUserRole(session.user.email);
          }
          setSessionReady(true);
          setVerifyingSession(false);
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [initialUrl]);

  const handleUpdatePassword = async () => {
    if (!password.trim()) {
      setError('Please enter a new password.');
      setSnackbarVisible(true);
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      setSnackbarVisible(true);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setSnackbarVisible(true);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Update password in Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message);
        setSnackbarVisible(true);
        setLoading(false);
        return;
      }

      // 2. Synchronize password column in table if applicable
      if (userEmail) {
        if (userRole === 'Coach') {
          await supabase
            .from('tbl_coaches')
            .update({ password: password, confirmPassword: password })
            .ilike('email', userEmail);
        } else {
          await supabase
            .from('tbl_athletes')
            .update({ password: password, confirmPassword: password })
            .ilike('email', userEmail);
        }
      }

      // 3. Clear session
      await supabase.auth.signOut();

      // 4. Alert & Redirect
      Alert.alert(
        'Password Updated',
        'Your password has been changed successfully! You can now sign in with your new credentials.',
        [
          {
            text: 'Go to Sign In',
            onPress: () => {
              if (userRole === 'Coach') {
                router.push('/coach-sign-in');
              } else {
                router.push('/athlete-sign-in');
              }
            },
          },
        ]
      );
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setSnackbarVisible(true);
    } finally {
      setLoading(false);
    }
  };

  if (verifyingSession) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          styles.centerContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>
          Verifying security link...
        </Text>
      </SafeAreaView>
    );
  }

  if (!sessionReady) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.brandingSection}>
            <Avatar.Icon
              size={72}
              icon="alert-circle-outline"
              style={{ backgroundColor: theme.colors.errorContainer }}
              color={theme.colors.onErrorContainer}
            />
            <Text
              variant="headlineSmall"
              style={[styles.appTitle, { color: theme.colors.onBackground }]}
            >
              Session Expired or Invalid
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}
            >
              The password reset link is invalid or has expired. Please request a new link.
            </Text>
          </View>

          <Button
            mode="contained"
            onPress={() => router.push('/athlete-forgot-password')}
            style={styles.actionButton}
            contentStyle={styles.buttonContent}
          >
            Athlete Forgot Password
          </Button>

          <Button
            mode="outlined"
            onPress={() => router.push('/coach-forgot-password')}
            style={styles.actionButton}
            contentStyle={styles.buttonContent}
          >
            Coach Forgot Password
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Branding Section ─── */}
          <View style={styles.brandingSection}>
            <Avatar.Icon
              size={72}
              icon="lock-reset"
              style={{ backgroundColor: theme.colors.primary }}
              color={theme.colors.onPrimary}
            />
            <Text
              variant="headlineMedium"
              style={[styles.appTitle, { color: theme.colors.onBackground }]}
            >
              SmartAthlete
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Create New Password
            </Text>
          </View>

          {/* ─── Form Section ─── */}
          <View style={styles.formSection}>
            {userEmail && (
              <Card style={[styles.infoCard, { backgroundColor: theme.colors.primaryContainer }]}>
                <Card.Content style={styles.infoCardContent}>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onPrimaryContainer, fontWeight: '600' }}
                  >
                    Resetting password for:
                  </Text>
                  <Text
                    variant="bodyMedium"
                    style={{ color: theme.colors.onPrimaryContainer, fontWeight: '700', marginTop: 2 }}
                  >
                    {userEmail} {userRole ? `(${userRole})` : ''}
                  </Text>
                </Card.Content>
              </Card>
            )}

            {/* New Password */}
            <TextInput
              mode="outlined"
              label="New Password"
              placeholder="Enter at least 6 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={secureTextEntry}
              autoCapitalize="none"
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={secureTextEntry ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setSecureTextEntry(!secureTextEntry)}
                />
              }
              style={styles.input}
              outlineStyle={styles.inputOutline}
              disabled={loading}
            />

            {/* Confirm New Password */}
            <TextInput
              mode="outlined"
              label="Confirm New Password"
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={secureConfirmTextEntry}
              autoCapitalize="none"
              left={<TextInput.Icon icon="lock-check-outline" />}
              right={
                <TextInput.Icon
                  icon={secureConfirmTextEntry ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setSecureConfirmTextEntry(!secureConfirmTextEntry)}
                />
              }
              style={styles.input}
              outlineStyle={styles.inputOutline}
              disabled={loading}
            />

            {/* Submit Button */}
            <Button
              mode="contained"
              onPress={handleUpdatePassword}
              style={styles.actionButton}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
              loading={loading}
              disabled={loading}
            >
              Update Password
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── Error Snackbar ─── */}
      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        action={{ label: 'OK', onPress: () => setSnackbarVisible(false) }}
        style={{ backgroundColor: theme.colors.errorContainer }}
      >
        <Text style={{ color: theme.colors.onErrorContainer }}>{error}</Text>
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  brandingSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  appTitle: {
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
    textAlign: 'center',
  },
  formSection: {
    flex: 1,
  },
  infoCard: {
    borderRadius: 12,
    marginBottom: 20,
  },
  infoCardContent: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  input: {
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  inputOutline: {
    borderRadius: 12,
  },
  actionButton: {
    borderRadius: 24,
    marginTop: 8,
    marginBottom: 12,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
