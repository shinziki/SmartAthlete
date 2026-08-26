import { supabase } from '@/lib/supabase';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Divider,
  Modal,
  Portal,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CoachForgotPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();

  // Screen steps: 1 = Verify Identity, 2 = Create New Password
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1: Verification Inputs
  const [identifier, setIdentifier] = useState('');
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Verified User Data
  const [verifiedCoach, setVerifiedCoach] = useState<{
    id?: string;
    firstName?: string;
    lastName?: string;
    email: string;
    username: string;
  } | null>(null);

  // Step 2: New Password Inputs
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [secureConfirmTextEntry, setSecureConfirmTextEntry] = useState(true);

  // Common UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  const formattedBirthDate = birthDate
    ? birthDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && selectedDate) {
        setBirthDate(selectedDate);
      }
    } else if (selectedDate) {
      setBirthDate(selectedDate);
    }
  };

  // ─── Step 1: Verify Identity ──────────────────────────────────
  const handleVerifyIdentity = async () => {
    const input = identifier.trim();

    if (!input) {
      setError('Please enter your coach username or registered email.');
      setSnackbarVisible(true);
      return;
    }

    if (!birthDate) {
      setError('Please select your date of birth.');
      setSnackbarVisible(true);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Format birthdate as YYYY-MM-DD
      const year = birthDate.getFullYear();
      const month = String(birthDate.getMonth() + 1).padStart(2, '0');
      const day = String(birthDate.getDate()).padStart(2, '0');
      const birthDateStr = `${year}-${month}-${day}`;

      const isEmail = input.includes('@');

      let query = supabase.from('tbl_coaches').select('*');

      if (isEmail) {
        query = query.ilike('email', input);
      } else {
        query = query.ilike('username', input);
      }

      const { data: coaches, error: lookupError } = await query;

      if (lookupError) {
        console.error('Coach lookup error:', lookupError.message);
        setError('Error checking coach account. Please try again.');
        setSnackbarVisible(true);
        setLoading(false);
        return;
      }

      if (!coaches || coaches.length === 0) {
        setError('No coach account found with that username or email.');
        setSnackbarVisible(true);
        setLoading(false);
        return;
      }

      const match = coaches.find(
        (c: any) =>
          c.birthdate === birthDateStr ||
          c.birthdate?.startsWith(birthDateStr)
      );

      if (!match) {
        setError('The birthdate does not match our records for this account.');
        setSnackbarVisible(true);
        setLoading(false);
        return;
      }

      setVerifiedCoach({
        firstName: match.firstName,
        lastName: match.lastName,
        email: match.email,
        username: match.username,
      });

      setStep(2);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setSnackbarVisible(true);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2: Update Password ─────────────────────────────────
  const handleUpdatePassword = async () => {
    if (!newPassword.trim()) {
      setError('Please enter a new password.');
      setSnackbarVisible(true);
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      setSnackbarVisible(true);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      setSnackbarVisible(true);
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (!verifiedCoach?.email) {
        throw new Error('Verification session lost. Please verify your identity again.');
      }

      // 1. Update password in tbl_coaches
      const { error: tableError } = await supabase
        .from('tbl_coaches')
        .update({
          password: newPassword,
          confirmPassword: newPassword,
        })
        .ilike('email', verifiedCoach.email);

      if (tableError) {
        throw new Error(tableError.message || 'Failed to update password.');
      }

      // 2. Also attempt to update Supabase Auth password if session exists
      try {
        await supabase.auth.updateUser({ password: newPassword });
      } catch (authErr) {
        // Non-blocking if no active auth session
      }

      Alert.alert(
        'Password Reset Successful',
        'Your password has been changed successfully! You can now sign in with your new password.',
        [
          {
            text: 'Sign In Now',
            onPress: () => router.push('/coach-sign-in'),
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
              icon="whistle"
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
              EVSU Ormoc · Coach Portal
            </Text>
          </View>

          {/* ─── Form Section ─── */}
          <View style={styles.formSection}>
            {step === 1 ? (
              /* ─── Step 1: Verify Identity ─── */
              <>
                <Text
                  variant="headlineSmall"
                  style={[styles.formTitle, { color: theme.colors.onBackground }]}
                >
                  Coach Forgot Password
                </Text>
                <Text
                  variant="bodyMedium"
                  style={[styles.formSubtitle, { color: theme.colors.onSurfaceVariant }]}
                >
                  Verify your identity with your registered coach credentials to reset your password.
                </Text>

                {/* Identifier Input */}
                <TextInput
                  mode="outlined"
                  label="Username or Email"
                  placeholder="e.g. username or coach@example.com"
                  value={identifier}
                  onChangeText={setIdentifier}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="username"
                  left={<TextInput.Icon icon="account-outline" />}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  disabled={loading}
                />

                {/* Birthdate Input */}
                <Pressable onPress={() => !loading && setShowDatePicker(true)}>
                  <TextInput
                    mode="outlined"
                    label="Date of Birth"
                    placeholder="Select your birthdate"
                    value={formattedBirthDate}
                    editable={false}
                    pointerEvents="none"
                    left={<TextInput.Icon icon="calendar-outline" />}
                    right={<TextInput.Icon icon="calendar" />}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    disabled={loading}
                  />
                </Pressable>

                {/* Android Date Picker */}
                {Platform.OS === 'android' && showDatePicker && (
                  <DateTimePicker
                    value={birthDate || new Date(2000, 0, 1)}
                    mode="date"
                    display="default"
                    maximumDate={new Date()}
                    minimumDate={new Date(1920, 0, 1)}
                    onChange={handleDateChange}
                  />
                )}

                {/* iOS Date Picker Modal */}
                {Platform.OS === 'ios' && (
                  <Portal>
                    <Modal
                      visible={showDatePicker}
                      onDismiss={() => setShowDatePicker(false)}
                      contentContainerStyle={[
                        styles.dateModalContainer,
                        { backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <Text
                        variant="titleMedium"
                        style={[styles.dateModalTitle, { color: theme.colors.onSurface }]}
                      >
                        Select Birthdate
                      </Text>
                      <DateTimePicker
                        value={birthDate || new Date(2000, 0, 1)}
                        mode="date"
                        display="spinner"
                        maximumDate={new Date()}
                        minimumDate={new Date(1920, 0, 1)}
                        onChange={handleDateChange}
                        style={styles.datePicker}
                      />
                      <Button
                        mode="contained"
                        onPress={() => {
                          if (!birthDate) setBirthDate(new Date(2000, 0, 1));
                          setShowDatePicker(false);
                        }}
                        style={styles.dateConfirmButton}
                      >
                        Confirm
                      </Button>
                    </Modal>
                  </Portal>
                )}

                {/* Verify Button */}
                <Button
                  mode="contained"
                  onPress={handleVerifyIdentity}
                  style={styles.actionButton}
                  contentStyle={styles.buttonContent}
                  labelStyle={styles.buttonLabel}
                  loading={loading}
                  disabled={loading}
                >
                  Verify Identity
                </Button>

                {/* Back to Sign In */}
                <Button
                  mode="outlined"
                  onPress={() => router.push('/coach-sign-in')}
                  style={styles.backButton}
                  contentStyle={styles.buttonContent}
                  disabled={loading}
                >
                  Back to Sign In
                </Button>
              </>
            ) : (
              /* ─── Step 2: Create New Password ─── */
              <>
                <Text
                  variant="headlineSmall"
                  style={[styles.formTitle, { color: theme.colors.onBackground }]}
                >
                  Create New Password
                </Text>

                {/* Verified Account Card */}
                <Card
                  style={[
                    styles.infoCard,
                    { backgroundColor: theme.colors.primaryContainer },
                  ]}
                >
                  <Card.Content>
                    <Text
                      variant="bodySmall"
                      style={{
                        color: theme.colors.onPrimaryContainer,
                        fontWeight: '600',
                      }}
                    >
                      Identity Verified
                    </Text>
                    <Text
                      variant="titleMedium"
                      style={{
                        color: theme.colors.onPrimaryContainer,
                        fontWeight: '700',
                        marginTop: 2,
                      }}
                    >
                      {verifiedCoach?.firstName} {verifiedCoach?.lastName}
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{
                        color: theme.colors.onPrimaryContainer,
                        opacity: 0.8,
                        marginTop: 2,
                      }}
                    >
                      {verifiedCoach?.email}
                    </Text>
                  </Card.Content>
                </Card>

                {/* New Password Input */}
                <TextInput
                  mode="outlined"
                  label="New Password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChangeText={setNewPassword}
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

                {/* Confirm Password Input */}
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

                {/* Update Password Button */}
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

                {/* Back to Step 1 */}
                <Button
                  mode="text"
                  onPress={() => setStep(1)}
                  disabled={loading}
                  style={{ marginTop: 4 }}
                >
                  Change Account
                </Button>
              </>
            )}

            {/* Divider */}
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

            {/* Athlete Switch */}
            <Button
              mode="text"
              onPress={() => router.push('/athlete-forgot-password')}
              style={styles.switchRoleButton}
              disabled={loading}
            >
              Are you an Athlete? Reset Athlete Password
            </Button>
          </View>

          {/* ─── Footer ─── */}
          <View style={styles.footer}>
            <Text
              variant="bodySmall"
              style={[styles.footerText, { color: theme.colors.onSurfaceVariant }]}
            >
              Data is protected under RA 10173 (Data Privacy Act).
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
  brandingSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  appTitle: {
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  formSection: {
    flex: 1,
  },
  formTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  formSubtitle: {
    marginBottom: 20,
    lineHeight: 20,
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
    marginTop: 4,
    marginBottom: 12,
  },
  backButton: {
    borderRadius: 24,
    marginBottom: 16,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  infoCard: {
    borderRadius: 14,
    marginBottom: 20,
  },
  switchRoleButton: {
    marginBottom: 16,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 16,
  },
  footerText: {
    textAlign: 'center',
    lineHeight: 18,
  },
  dateModalContainer: {
    margin: 20,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  dateModalTitle: {
    fontWeight: '600',
    marginBottom: 16,
  },
  datePicker: {
    height: 200,
    width: '100%',
  },
  dateConfirmButton: {
    marginTop: 16,
    borderRadius: 24,
    width: '100%',
  },
});
