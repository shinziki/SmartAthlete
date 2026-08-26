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
    Menu,
    Modal,
    Portal,
    Snackbar,
    Text,
    TextInput,
    useTheme
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const GENDER_OPTIONS = [
    { label: 'Male', icon: 'gender-male' },
    { label: 'Female', icon: 'gender-female' },
    { label: 'Other', icon: 'gender-non-binary' },
    { label: 'Prefer not to say', icon: 'account-question-outline' },
];

export default function AthleteRegisterScreen() {
    const theme = useTheme();
    const router = useRouter();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [gender, setGender] = useState('');
    const [genderMenuVisible, setGenderMenuVisible] = useState(false);
    const [birthDate, setBirthDate] = useState<Date | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [secureTextEntry, setSecureTextEntry] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [snackbarVisible, setSnackbarVisible] = useState(false);

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

    const formattedBirthDate = birthDate
        ? birthDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
        : '';

    const handleRegister = async () => {
        const cleanEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@evsu\.edu\.ph$/;

        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            setError('Please use your valid school email (@evsu.edu.ph).');
            setSnackbarVisible(true);
            return;
        }

        // Validate required fields
        if (!firstName.trim() || !lastName.trim() || !username.trim() || !password.trim()) {
            setError('Please fill in all required fields.');
            setSnackbarVisible(true);
            return;
        }

        if (!gender) {
            setError('Please select a gender.');
            setSnackbarVisible(true);
            return;
        }

        if (!birthDate) {
            setError('Please select your birthdate.');
            setSnackbarVisible(true);
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            setSnackbarVisible(true);
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            setSnackbarVisible(true);
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Format birthdate as YYYY-MM-DD for storage
            const birthdateStr = birthDate.toISOString().split('T')[0];

            // Sign up with Supabase Auth
            const { data: authData, error: signUpError } = await supabase.auth.signUp({
                email: email.trim(),
                password: password,
                options: {
                    data: {
                        firstName: firstName.trim(),
                        middleName: middleName.trim(),
                        lastName: lastName.trim(),
                        username: username.trim(),
                        birthdate: birthdateStr,
                        gender: gender,
                        role: 'Athlete',
                    },
                },
            });

            if (signUpError) {
                setError(signUpError.message);
                setSnackbarVisible(true);
                setLoading(false);
                return;
            }

            // Insert profile data into tbl_athletes
            const { error: profileError } = await supabase
                .from('tbl_athletes')
                .insert({
                    firstName: firstName.trim(),
                    middleName: middleName.trim(),
                    lastName: lastName.trim(),
                    username: username.trim(),
                    birthdate: birthdateStr,
                    gender: gender,
                    email: cleanEmail,
                    password: password,
                    confirmPassword: confirmPassword,
                    role: 'Athlete',
                });

            if (profileError) {
                setError(profileError.message);
                setSnackbarVisible(true);
                setLoading(false);
                return;
            }

            Alert.alert(
                'Account Created',
                'Your athlete account has been created successfully! Please check your email to verify your account.',
                [{ text: 'OK', onPress: () => router.push('/athlete-sign-in') }]
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
                            Athlete Register
                        </Text>
                        <Text
                            variant="bodyMedium"
                            style={[styles.formSubtitle, { color: theme.colors.onSurfaceVariant }]}
                        >
                            Create your athlete credentials
                        </Text>

                        {/* First Name Input */}
                        <TextInput
                            mode="outlined"
                            label="First Name"
                            value={firstName}
                            onChangeText={setFirstName}
                            keyboardType="default"
                            autoCapitalize="words"
                            left={<TextInput.Icon icon="account" />}
                            style={styles.input}
                            outlineStyle={styles.inputOutline}
                            disabled={loading}
                        />

                        {/* Middle Name Input */}
                        <TextInput
                            mode="outlined"
                            label="Middle Name"
                            value={middleName}
                            onChangeText={setMiddleName}
                            keyboardType="default"
                            autoCapitalize="words"
                            left={<TextInput.Icon icon="account" />}
                            style={styles.input}
                            outlineStyle={styles.inputOutline}
                            disabled={loading}
                        />

                        {/* Last Name Input */}
                        <TextInput
                            mode="outlined"
                            label="Last Name"
                            value={lastName}
                            onChangeText={setLastName}
                            keyboardType="default"
                            autoCapitalize="words"
                            left={<TextInput.Icon icon="account" />}
                            style={styles.input}
                            outlineStyle={styles.inputOutline}
                            disabled={loading}
                        />

                        {/* Username Input */}
                        <TextInput
                            mode="outlined"
                            label="Username"
                            value={username}
                            onChangeText={setUsername}
                            keyboardType="default"
                            autoCapitalize="none"
                            autoComplete="username"
                            left={<TextInput.Icon icon="file-account" />}
                            style={styles.input}
                            outlineStyle={styles.inputOutline}
                            disabled={loading}
                        />

                        {/* Birthdate Date Selection */}
                        <Pressable onPress={() => !loading && setShowDatePicker(true)}>
                            <TextInput
                                mode="outlined"
                                label="Birthdate"
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
                                        { backgroundColor: theme.colors.elevation.level3 },
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
                                        textColor={theme.colors.onSurface}
                                    />
                                    <Button
                                        mode="contained"
                                        onPress={() => {
                                            if (!birthDate) setBirthDate(new Date(2000, 0, 1));
                                            setShowDatePicker(false);
                                        }}
                                        style={styles.dateModalDoneButton}
                                    >
                                        Done
                                    </Button>
                                </Modal>
                            </Portal>
                        )}

                        {/* Gender Dropdown Selection */}
                        <Menu
                            visible={genderMenuVisible}
                            onDismiss={() => setGenderMenuVisible(false)}
                            anchor={
                                <Pressable onPress={() => !loading && setGenderMenuVisible(true)}>
                                    <TextInput
                                        mode="outlined"
                                        label="Gender"
                                        value={gender}
                                        editable={false}
                                        pointerEvents="none"
                                        left={<TextInput.Icon icon="account-supervisor-outline" />}
                                        right={
                                            <TextInput.Icon
                                                icon={genderMenuVisible ? 'chevron-up' : 'chevron-down'}
                                            />
                                        }
                                        style={styles.input}
                                        outlineStyle={styles.inputOutline}
                                        disabled={loading}
                                    />
                                </Pressable>
                            }
                            contentStyle={[
                                styles.menuContent,
                                { backgroundColor: theme.colors.elevation.level3 },
                            ]}
                        >
                            {GENDER_OPTIONS.map((item) => (
                                <Menu.Item
                                    key={item.label}
                                    onPress={() => {
                                        setGender(item.label);
                                        setGenderMenuVisible(false);
                                    }}
                                    title={item.label}
                                    leadingIcon={item.icon}
                                    trailingIcon={gender === item.label ? 'check' : undefined}
                                />
                            ))}
                        </Menu>

                        {/* Email Input */}
                        <TextInput
                            mode="outlined"
                            label="School Email"
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoComplete="email"
                            left={<TextInput.Icon icon="email-outline" />}
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

                        {/* Confirm Password Input */}
                        <TextInput
                            mode="outlined"
                            label="Confirm Password"
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
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

                        {/* Create Account Button */}
                        <Button
                            mode="contained"
                            onPress={handleRegister}
                            style={styles.signInButton}
                            contentStyle={styles.signInButtonContent}
                            labelStyle={styles.signInButtonLabel}
                            loading={loading}
                            disabled={loading}
                        >
                            Create Account
                        </Button>

                        {/* Back to Sign In Button */}
                        <Button
                            mode="contained-tonal"
                            onPress={() => { router.push('/athlete-sign-in') }}
                            style={styles.signInButton}
                            contentStyle={styles.signInButtonContent}
                            labelStyle={styles.signInButtonLabel}
                            disabled={loading}
                        >
                            Back to Sign In
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

    // ─── Modal & Menu ───
    dateModalContainer: {
        marginHorizontal: 24,
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
    },
    dateModalTitle: {
        marginBottom: 16,
        fontWeight: '600',
    },
    dateModalDoneButton: {
        marginTop: 16,
        borderRadius: 12,
        alignSelf: 'stretch',
    },
    menuContent: {
        borderRadius: 12,
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
