import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import {
  Avatar,
  Button,
  Divider,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AthleteSignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  const handleSignIn = async () => {
    const input = username.trim();

    if (!input || !password.trim()) {
      setError('Please enter both username and password.');
      setSnackbarVisible(true);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const isEmail = input.includes('@');

      // 1. Look up athlete in tbl_athletes
      let athleteQuery = supabase
        .from('tbl_athletes')
        .select('email, password');

      if (isEmail) {
        athleteQuery = athleteQuery.ilike('email', input);
      } else {
        athleteQuery = athleteQuery.ilike('username', input);
      }

      const { data: athleteData, error: lookupError } = await athleteQuery.maybeSingle();

      if (lookupError) {
        console.error('Supabase lookup error:', lookupError.message);
      }

      if (!athleteData || !athleteData.email) {
        setError('No athlete account found with that username or email.');
        setSnackbarVisible(true);
        setLoading(false);
        return;
      }

      // 2. Validate against ground-truth password in tbl_athletes
      if (athleteData.password && athleteData.password !== password) {
        setError('Invalid username or password.');
        setSnackbarVisible(true);
        setLoading(false);
        return;
      }

      // 3. Sign in with Supabase Auth
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: athleteData.email.trim(),
        password: password,
      });

      if (signInError) {
        console.warn('Supabase Auth error:', signInError.message);
      }

      router.replace('/athlete/device-check');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setSnackbarVisible(true);
    } finally {
      setLoading(false);
    }
  };

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
              icon="account"
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
              EVSU Ormoc · Athletic Management
            </Text>
          </View>

          {/* ─── Form Section ─── */}
          <View style={styles.formSection}>
            <Text
              variant="headlineSmall"
              style={[styles.formTitle, { color: theme.colors.onBackground }]}
            >
              Athlete Sign In
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.formSubtitle, { color: theme.colors.onSurfaceVariant }]}
            >
              Use your athlete credentials
            </Text>

            {/* Username Input */}
            <TextInput
              mode="outlined"
              label="Username or School Email"
              value={username}
              onChangeText={setUsername}
              keyboardType="default"
              autoCapitalize="none"
              autoComplete="username"
              left={<TextInput.Icon icon="account-outline" />}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              disabled={loading}
            />

            {/* Password Input */}
            <TextInput
              mode="outlined"
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={secureTextEntry}
              autoCapitalize="none"
              autoComplete="password"
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

            {/* Forgot Password */}
            <View style={styles.forgotPasswordRow}>
              <Button
                mode="text"
                compact
                onPress={() => { router.push('/athlete-forgot-password') }}
                labelStyle={styles.forgotPasswordLabel}
              >
                Forgot password?
              </Button>
            </View>

            {/* Sign In Button */}
            <Button
              mode="contained"
              onPress={handleSignIn}
              style={styles.signInButton}
              contentStyle={styles.signInButtonContent}
              labelStyle={styles.signInButtonLabel}
              loading={loading}
              disabled={loading}
            >
              Sign In
            </Button>

            {/* Create Account Button */}
            <Button
              mode="contained-tonal"
              onPress={() => router.push('/athlete-register')}
              style={styles.signInButton}
              contentStyle={styles.signInButtonContent}
              labelStyle={styles.signInButtonLabel}
              disabled={loading}
            >
              Create Account
            </Button>

            {/* Divider with "or" */}
            <View style={styles.dividerRow}>
              <Divider style={styles.dividerLine} />
              <Text
                variant="bodySmall"
                style={[styles.dividerText, { color: theme.colors.onSurfaceVariant }]}
              >
                or
              </Text>
              <Divider style={styles.dividerLine} />
            </View>

            {/* Coach Sign-In Navigation */}
            <Button
              mode="outlined"
              onPress={() => router.push('/coach-sign-in')}
              style={styles.coachButton}
              contentStyle={styles.coachButtonContent}
              disabled={loading}
            >
              Sign in as Coach
            </Button>
          </View>

          {/* ─── Footer ─── */}
          <View style={styles.footer}>
            <Text
              variant="bodySmall"
              style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}
            >
              By signing in you agree to our{' '}
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                onPress={() => { }}
              >
                Terms of Use
              </Text>
              . Data is{'\n'}protected under RA 10173.
            </Text>
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
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },

  // ─── Branding ───
  brandingSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  appTitle: {
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },

  // ─── Form ───
  formSection: {
    flex: 1,
  },
  formTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  formSubtitle: {
    marginBottom: 20,
  },
  input: {
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  inputOutline: {
    borderRadius: 12,
  },
  forgotPasswordRow: {
    alignItems: 'flex-end',
    marginBottom: 8,
    marginTop: -4,
  },
  forgotPasswordLabel: {
    fontSize: 13,
  },

  // ─── Sign In Button ───
  signInButton: {
    borderRadius: 24,
    marginBottom: 20,
  },
  signInButtonContent: {
    paddingVertical: 6,
  },
  signInButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // ─── Divider ───
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
  },

  // ─── Coach Button ───
  coachButton: {
    borderRadius: 24,
    marginBottom: 24,
  },
  coachButtonContent: {
    paddingVertical: 6,
  },

  // ─── Footer ───
  footer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    textAlign: 'center',
    lineHeight: 18,
  },
});
