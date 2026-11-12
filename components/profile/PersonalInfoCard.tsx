import { emailHash, maskEmail, maskProfileField } from '@/lib/privacy';
import { supabase } from '@/lib/supabase';
import { clearIdentityCache } from '@/lib/sessionService';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import {
    Button,
    Card,
    Divider,
    IconButton,
    List,
    Menu,
    Modal,
    Portal,
    Text,
    TextInput,
    useTheme,
} from 'react-native-paper';

// ─── Types & field config ────────────────────────────────────

export interface PersonalProfile {
    firstName: string;
    middleName: string;
    lastName: string;
    username: string;
    birthdate: string; // stored as YYYY-MM-DD
    gender: string;
}

type FieldKey = keyof PersonalProfile | 'email';

interface FieldDef {
    key: FieldKey;
    label: string;
    icon: string;
    kind: 'text' | 'email' | 'date' | 'select';
    required?: boolean;
}

const FIELDS: FieldDef[] = [
    { key: 'firstName', label: 'First name', icon: 'account-outline', kind: 'text', required: true },
    { key: 'middleName', label: 'Middle name', icon: 'account-outline', kind: 'text' },
    { key: 'lastName', label: 'Last name', icon: 'account-outline', kind: 'text', required: true },
    { key: 'username', label: 'Username', icon: 'at', kind: 'text', required: true },
    { key: 'email', label: 'Email', icon: 'email-outline', kind: 'email', required: true },
    { key: 'birthdate', label: 'Birthdate', icon: 'cake-variant-outline', kind: 'date' },
    { key: 'gender', label: 'Gender', icon: 'account-supervisor-outline', kind: 'select' },
];

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];

// ─── Helpers ─────────────────────────────────────────────────

function formatBirthdate(raw: string): string {
    if (!raw) return 'Not set';
    const d = new Date(`${raw}T00:00:00`);
    return isNaN(d.getTime())
        ? raw
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Local-time YYYY-MM-DD (toISOString shifts the day back in timezones ahead of UTC).
function toDateString(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

function parseDate(raw: string): Date {
    const d = new Date(`${raw}T00:00:00`);
    return isNaN(d.getTime()) ? new Date(2000, 0, 1) : d;
}

// ─── Component ───────────────────────────────────────────────

interface Props {
    table: 'tbl_athletes' | 'tbl_coaches';
    recordId: number | null;
    email: string;
    profile: PersonalProfile;
    onProfileChange: (updates: Partial<PersonalProfile>) => void;
    onEmailChange: (email: string) => void;
}

export default function PersonalInfoCard({
    table,
    recordId,
    email,
    profile,
    onProfileChange,
    onEmailChange,
}: Props) {
    const theme = useTheme();
    const [editing, setEditing] = useState<FieldKey | null>(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [pickerDate, setPickerDate] = useState(new Date(2000, 0, 1));

    const currentValue = (key: FieldKey): string => (key === 'email' ? email : profile[key]);

    const startEdit = (key: FieldKey) => {
        if (saving) return;
        setDraft(currentValue(key));
        if (key === 'birthdate') setPickerDate(parseDate(profile.birthdate));
        setEditing(key);
    };

    const cancelEdit = () => {
        if (!saving) setEditing(null);
    };

    const save = async (key: FieldKey, raw: string) => {
        const value = raw.trim();
        const def = FIELDS.find((f) => f.key === key)!;

        if (def.required && !value) {
            Alert.alert('Missing details', `${def.label} can't be empty.`);
            return;
        }
        if (key === 'email' && !/^\S+@\S+\.\S+$/.test(value)) {
            Alert.alert('Invalid email', 'Enter a valid email address.');
            return;
        }
        if (value === currentValue(key)) {
            setEditing(null);
            return;
        }

        setSaving(true);
        try {
            if (key === 'email') {
                const { data, error } = await supabase.auth.updateUser({ email: value });
                if (error) throw error;

                // Only touch the table once the auth email has really changed, because
                // the app finds this record by matching the auth email.
                if (data.user?.email?.toLowerCase() === value.toLowerCase()) {
                    if (recordId != null) {
                        const { error: tableError } = await supabase
                            .from(table)
                            .update({ email: maskEmail(value), email_hash: emailHash(value) })
                            .eq('id', recordId);
                        if (tableError) throw tableError;
                    }
                    onEmailChange(value);
                } else {
                    Alert.alert(
                        'Check your new email',
                        `We sent a confirmation link to ${value}. Your email changes after you confirm it.`
                    );
                }
            } else {
                if (recordId != null) {
                    const { error } = await supabase
                        .from(table)
                        .update({ [key]: maskProfileField(key, value) })
                        .eq('id', recordId);
                    if (error) throw error;
                }
                const { error: authError } = await supabase.auth.updateUser({ data: { [key]: value } });
                if (authError) throw authError;
                onProfileChange({ [key]: value } as Partial<PersonalProfile>);
            }
            clearIdentityCache();
            setEditing(null);
        } catch (err: any) {
            Alert.alert('Could not save', err.message || 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleDateChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === 'android') {
            if (event.type === 'set' && selected) save('birthdate', toDateString(selected));
            else setEditing(null);
            return;
        }
        if (selected) setPickerDate(selected);
    };

    const displayValue = (key: FieldKey): string => {
        const v = currentValue(key);
        if (key === 'birthdate') return formatBirthdate(v);
        return v || (key === 'middleName' ? '—' : 'Not set');
    };

    return (
        <Card
            mode="elevated"
            style={[styles.card, { backgroundColor: theme.colors.elevation.level1 }]}
        >
            <Card.Content style={styles.content}>
                <Text variant="titleSmall" style={[styles.title, { color: theme.colors.onSurface }]}>
                    Personal information
                </Text>

                {FIELDS.map((f, i) => {
                    const typing = editing === f.key && (f.kind === 'text' || f.kind === 'email');
                    return (
                        <React.Fragment key={f.key}>
                            {i > 0 ? <Divider /> : null}

                            {typing ? (
                                <View style={styles.editRow}>
                                    <TextInput
                                        mode="outlined"
                                        label={f.label}
                                        value={draft}
                                        onChangeText={setDraft}
                                        autoFocus
                                        autoCapitalize={f.kind === 'email' || f.key === 'username' ? 'none' : 'words'}
                                        keyboardType={f.kind === 'email' ? 'email-address' : 'default'}
                                        disabled={saving}
                                        style={styles.editInput}
                                    />
                                    <IconButton
                                        icon="check"
                                        mode="contained"
                                        disabled={saving}
                                        onPress={() => save(f.key, draft)}
                                        accessibilityLabel={`Save ${f.label}`}
                                    />
                                    <IconButton
                                        icon="close"
                                        disabled={saving}
                                        onPress={cancelEdit}
                                        accessibilityLabel="Cancel"
                                    />
                                </View>
                            ) : (
                                <View style={styles.row}>
                                    <List.Icon icon={f.icon} />
                                    <View style={styles.rowText}>
                                        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                            {f.label}
                                        </Text>
                                        <Text variant="bodyLarge" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
                                            {displayValue(f.key)}
                                        </Text>
                                    </View>

                                    {f.kind === 'select' ? (
                                        <Menu
                                            visible={editing === 'gender'}
                                            onDismiss={cancelEdit}
                                            anchor={
                                                <IconButton
                                                    icon="pencil-outline"
                                                    onPress={() => startEdit('gender')}
                                                    accessibilityLabel="Edit gender"
                                                />
                                            }
                                        >
                                            {GENDER_OPTIONS.map((opt) => (
                                                <Menu.Item
                                                    key={opt}
                                                    title={opt}
                                                    trailingIcon={profile.gender === opt ? 'check' : undefined}
                                                    onPress={() => save('gender', opt)}
                                                />
                                            ))}
                                        </Menu>
                                    ) : (
                                        <IconButton
                                            icon="pencil-outline"
                                            onPress={() => startEdit(f.key)}
                                            accessibilityLabel={`Edit ${f.label}`}
                                        />
                                    )}
                                </View>
                            )}
                        </React.Fragment>
                    );
                })}

                {/* Android date picker (native dialog) */}
                {Platform.OS === 'android' && editing === 'birthdate' && (
                    <DateTimePicker
                        value={pickerDate}
                        mode="date"
                        display="default"
                        maximumDate={new Date()}
                        minimumDate={new Date(1920, 0, 1)}
                        onChange={handleDateChange}
                    />
                )}

                {/* iOS date picker (modal) */}
                {Platform.OS === 'ios' && (
                    <Portal>
                        <Modal
                            visible={editing === 'birthdate'}
                            onDismiss={cancelEdit}
                            contentContainerStyle={[
                                styles.dateModal,
                                { backgroundColor: theme.colors.elevation.level3 },
                            ]}
                        >
                            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 8 }}>
                                Select birthdate
                            </Text>
                            <DateTimePicker
                                value={pickerDate}
                                mode="date"
                                display="spinner"
                                maximumDate={new Date()}
                                minimumDate={new Date(1920, 0, 1)}
                                onChange={handleDateChange}
                                textColor={theme.colors.onSurface}
                            />
                            <Button
                                mode="contained"
                                loading={saving}
                                disabled={saving}
                                onPress={() => save('birthdate', toDateString(pickerDate))}
                                style={{ marginTop: 8 }}
                            >
                                Done
                            </Button>
                        </Modal>
                    </Portal>
                )}
            </Card.Content>
        </Card>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 20 },
    content: { gap: 4 },
    title: { fontWeight: '700', marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
    rowText: { flex: 1, gap: 2 },
    editRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
    editInput: { flex: 1 },
    dateModal: { margin: 24, padding: 20, borderRadius: 20 },
});