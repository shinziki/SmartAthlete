import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Divider,
  Icon,
  IconButton,
  Menu,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────

type SessionType = 'training' | 'sc' | 'scrimmage';

const SESSION_TYPE_BUTTONS = [
  { value: 'training' as SessionType, label: 'Training' },
  { value: 'sc' as SessionType, label: 'S&C' },
  { value: 'scrimmage' as SessionType, label: 'Scrimmage' },
];

const VENUES = [
  'EVSU Ormoc Gymnasium',
  'EVSU Ormoc Outdoor Court',
  'Ormoc City Sports Complex',
];

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Main Screen ──────────────────────────────────────────────

export default function AddSessionScreen() {
  const theme = useTheme();
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState('');
  const [sessionType, setSessionType] = useState<SessionType>('training');
  const [date, setDate] = useState(new Date());
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [venue, setVenue] = useState(VENUES[0]);
  const [geofenceRadius, setGeofenceRadius] = useState('40');
  const [drills, setDrills] = useState('');

  // Picker visibility
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [venueMenuVisible, setVenueMenuVisible] = useState(false);

  // ─── Date / Time Handlers ───

  const onDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) setDate(selectedDate);
  };

  const onStartTimeChange = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowStartTimePicker(false);
    if (selected) setStartTime(selected);
  };

  const onEndTimeChange = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowEndTimePicker(false);
    if (selected) setEndTime(selected);
  };

  // ─── Submit Handler ───

  const handleCreate = () => {
    // TODO: Save to Supabase tbl_sessions
    console.log({
      title,
      sessionType,
      date,
      startTime,
      endTime,
      venue,
      geofenceRadius,
      drills,
    });
    router.back();
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {/* ─── App Bar ─── */}
        <View style={styles.appBar}>
          <IconButton
            icon="arrow-left"
            size={24}
            onPress={() => router.back()}
            iconColor={theme.colors.onSurface}
          />
          <Text
            variant="titleLarge"
            style={[styles.appBarTitle, { color: theme.colors.onSurface }]}
          >
            Add session
          </Text>
          <View style={{ width: 48 }} />
        </View>

        <Divider />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ═══ SESSION DETAILS ═══ */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            SESSION DETAILS
          </Text>

          <TextInput
            mode="outlined"
            label="Session title"
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            outlineStyle={styles.inputOutline}
          />

          {/* ═══ SESSION TYPE ═══ */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            SESSION TYPE
          </Text>

          <SegmentedButtons
            value={sessionType}
            onValueChange={(val) => setSessionType(val as SessionType)}
            buttons={SESSION_TYPE_BUTTONS}
            style={styles.segmentedButtons}
          />

          {/* ═══ SCHEDULE ═══ */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            SCHEDULE
          </Text>

          {/* Date Picker */}
          <Pressable onPress={() => setShowDatePicker(true)}>
            <TextInput
              mode="outlined"
              label="Date"
              value={formatDate(date)}
              editable={false}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              right={
                <TextInput.Icon
                  icon="calendar"
                  onPress={() => setShowDatePicker(true)}
                />
              }
            />
          </Pressable>

          {showDatePicker && (
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
            />
          )}

          {/* Start / End Time Row */}
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Pressable onPress={() => setShowStartTimePicker(true)}>
                <TextInput
                  mode="outlined"
                  label="Start time"
                  value={startTime ? formatTime(startTime) : ''}
                  editable={false}
                  style={styles.timeInput}
                  outlineStyle={styles.inputOutline}
                  right={
                    <TextInput.Icon
                      icon="clock-outline"
                      onPress={() => setShowStartTimePicker(true)}
                    />
                  }
                />
              </Pressable>
            </View>
            <View style={styles.timeField}>
              <Pressable onPress={() => setShowEndTimePicker(true)}>
                <TextInput
                  mode="outlined"
                  label="End time"
                  value={endTime ? formatTime(endTime) : ''}
                  editable={false}
                  style={styles.timeInput}
                  outlineStyle={styles.inputOutline}
                  right={
                    <TextInput.Icon
                      icon="clock-outline"
                      onPress={() => setShowEndTimePicker(true)}
                    />
                  }
                />
              </Pressable>
            </View>
          </View>

          {showStartTimePicker && (
            <DateTimePicker
              value={startTime ?? new Date()}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onStartTimeChange}
            />
          )}

          {showEndTimePicker && (
            <DateTimePicker
              value={endTime ?? new Date()}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onEndTimeChange}
            />
          )}

          {/* ═══ LOCATION ═══ */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            LOCATION
          </Text>

          {/* Venue Dropdown */}
          <Menu
            visible={venueMenuVisible}
            onDismiss={() => setVenueMenuVisible(false)}
            anchor={
              <Pressable onPress={() => setVenueMenuVisible(true)}>
                <TextInput
                  mode="outlined"
                  label="Venue"
                  value={venue}
                  editable={false}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  right={
                    <TextInput.Icon
                      icon="chevron-down"
                      onPress={() => setVenueMenuVisible(true)}
                    />
                  }
                />
              </Pressable>
            }
            anchorPosition="bottom"
            contentStyle={{ backgroundColor: theme.colors.elevation.level2 }}
          >
            {VENUES.map((v) => (
              <Menu.Item
                key={v}
                onPress={() => {
                  setVenue(v);
                  setVenueMenuVisible(false);
                }}
                title={v}
              />
            ))}
          </Menu>

          {/* Geofence Radius */}
          <TextInput
            mode="outlined"
            label="Geofence radius"
            value={geofenceRadius}
            onChangeText={setGeofenceRadius}
            keyboardType="numeric"
            right={<TextInput.Affix text="m" />}
            style={styles.input}
            outlineStyle={styles.inputOutline}
          />

          {/* ═══ DRILLS ═══ */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            DRILLS
          </Text>

          <TextInput
            mode="outlined"
            label="Drills (one per line)"
            value={drills}
            onChangeText={setDrills}
            multiline
            numberOfLines={4}
            style={[styles.input, styles.drillsInput]}
            outlineStyle={styles.inputOutline}
          />

          {/* ─── Geofence Info Banner ─── */}
          <View
            style={[
              styles.infoBanner,
              { backgroundColor: theme.colors.elevation.level1 },
            ]}
          >
            <Icon source="map-marker" size={16} color={theme.colors.error} />
            <Text
              variant="bodySmall"
              style={[styles.infoBannerText, { color: theme.colors.onSurfaceVariant }]}
            >
              Wearables will auto-check-in within the geofence
            </Text>
          </View>

          {/* ─── Create Session Button ─── */}
          <Button
            mode="contained"
            onPress={handleCreate}
            style={styles.createButton}
            contentStyle={styles.createButtonContent}
            labelStyle={styles.createButtonLabel}
          >
            Create session
          </Button>

          {/* ─── Footer Note ─── */}
          <Text
            variant="bodySmall"
            style={[styles.footerNote, { color: theme.colors.onSurfaceVariant }]}
          >
            Athletes' devices will receive push notification · Check-in window ±15 min
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },

  // ─── App Bar ───
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    height: 56,
  },
  appBarTitle: {
    flex: 1,
    fontWeight: '600',
  },

  // ─── Scroll ───
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },

  // ─── Section Labels ───
  sectionLabel: {
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 12,
  },

  // ─── Inputs ───
  input: {
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  inputOutline: {
    borderRadius: 12,
  },
  segmentedButtons: {
    marginBottom: 4,
  },

  // ─── Time Row ───
  timeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeField: {
    flex: 1,
  },
  timeInput: {
    marginBottom: 12,
    backgroundColor: 'transparent',
  },

  // ─── Drills ───
  drillsInput: {
    minHeight: 100,
  },

  // ─── Info Banner ───
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 20,
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
  },

  // ─── Create Button ───
  createButton: {
    borderRadius: 28,
    marginBottom: 12,
  },
  createButtonContent: {
    paddingVertical: 8,
  },
  createButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ─── Footer ───
  footerNote: {
    textAlign: 'center',
    lineHeight: 18,
  },
});
