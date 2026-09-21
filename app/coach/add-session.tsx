import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
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
  Button,
  Divider,
  Icon,
  IconButton,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import DrillsEditor, { DrillItem } from '../../components/DrillsEditor';
import VenueMapPicker, { VenueCoords } from '../../components/VenueMapPicker';
import { createSession, getCurrentCoachRecord } from '../../lib/sessionService';

// ─── Types ────────────────────────────────────────────────────

type SessionType = 'training' | 'sc' | 'scrimmage';
type LocationType = 'venue' | 'at_home';

const SESSION_TYPE_BUTTONS = [
  { value: 'training' as SessionType, label: 'Training' },
  { value: 'sc' as SessionType, label: 'S&C' },
  { value: 'scrimmage' as SessionType, label: 'Scrimmage' },
];

const LOCATION_TYPE_BUTTONS = [
  { value: 'venue' as LocationType, label: 'Venue', icon: 'map-marker' },
  { value: 'at_home' as LocationType, label: 'At Home', icon: 'home' },
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
  const [locationType, setLocationType] = useState<LocationType>('venue');
  const [venueName, setVenueName] = useState('');
  const [venueCoords, setVenueCoords] = useState<VenueCoords | null>(null);
  const [geofenceRadius, setGeofenceRadius] = useState('40');
  const [drills, setDrills] = useState<DrillItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Picker visibility
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

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

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for the session.');
      return;
    }

    if (locationType === 'venue' && !venueName.trim()) {
      Alert.alert('Missing Venue', 'Please enter a venue name for this session.');
      return;
    }

    setSaving(true);

    try {
      const totalDurationMinutes = drills.reduce(
        (sum, d) => sum + (Number(d.durationMinutes) || 0),
        0
      );

      const coach = await getCurrentCoachRecord();

      await createSession({
        title: title.trim(),
        sessionType,
        date,
        startTime,
        endTime,
        locationType,
        venueName: locationType === 'venue' ? venueName.trim() : null,
        latitude: locationType === 'venue' ? venueCoords?.latitude : null,
        longitude: locationType === 'venue' ? venueCoords?.longitude : null,
        geofenceRadius: locationType === 'venue' ? Number(geofenceRadius) || 40 : 40,
        drills,
        totalDurationMinutes,
        coachId: coach?.id,
        coachName: coach?.fullName,
      });

      Alert.alert('Session Created', 'Upcoming session has been saved successfully!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      console.error('Failed to create session:', err);
      Alert.alert('Error', err.message || 'Failed to save session. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Parsed radius for the map circle (with fallback)
  const parsedRadius = Math.max(10, Number(geofenceRadius) || 40);

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

          {/* Location Type Toggle */}
          <SegmentedButtons
            value={locationType}
            onValueChange={(val) => setLocationType(val as LocationType)}
            buttons={LOCATION_TYPE_BUTTONS}
            style={styles.locationToggle}
          />

          {locationType === 'venue' ? (
            <>
              {/* Venue Name */}
              <TextInput
                mode="outlined"
                label="Venue name"
                placeholder="e.g. EVSU Ormoc Gymnasium"
                value={venueName}
                onChangeText={setVenueName}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="map-marker" />}
              />

              {/* Map Picker */}
              <VenueMapPicker
                coords={venueCoords}
                onCoordsChange={setVenueCoords}
                geofenceRadius={parsedRadius}
              />

              {/* Map hint */}
              <Text
                variant="bodySmall"
                style={[styles.mapHint, { color: theme.colors.onSurfaceVariant }]}
              >
                Tap the map to place the venue pin, or drag it to adjust
              </Text>

              {/* Geofence Radius */}
              <TextInput
                mode="outlined"
                label="Geofence radius"
                value={geofenceRadius}
                onChangeText={setGeofenceRadius}
                keyboardType="numeric"
                right={<TextInput.Affix text="m" />}
                left={<TextInput.Icon icon="radius-outline" />}
                style={styles.input}
                outlineStyle={styles.inputOutline}
              />

              {/* ─── Geofence Info Banner ─── */}
              <View
                style={[
                  styles.infoBanner,
                  { backgroundColor: theme.colors.elevation.level1 },
                ]}
              >
                <Icon source="watch" size={16} color={theme.colors.primary} />
                <Text
                  variant="bodySmall"
                  style={[styles.infoBannerText, { color: theme.colors.onSurfaceVariant }]}
                >
                  Wear OS will auto-check-in when the athlete enters the{' '}
                  {geofenceRadius}m geofence
                </Text>
              </View>
            </>
          ) : (
            /* ─── At Home Banner ─── */
            <View
              style={[
                styles.atHomeBanner,
                { backgroundColor: theme.colors.elevation.level1 },
              ]}
            >
              <Icon source="home-outline" size={20} color={theme.colors.primary} />
              <View style={styles.atHomeBannerContent}>
                <Text
                  variant="bodyMedium"
                  style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                >
                  At-home session
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  No location tracking — the athlete trains at home
                </Text>
              </View>
            </View>
          )}

          {/* ═══ TRAINING REGIME (DRILLS) ═══ */}
          <Text
            variant="labelLarge"
            style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
          >
            TRAINING REGIME (DRILLS)
          </Text>

          <DrillsEditor drills={drills} onChangeDrills={setDrills} />

          {/* ─── Create Session Button ─── */}
          <Button
            mode="contained"
            onPress={handleCreate}
            style={styles.createButton}
            contentStyle={styles.createButtonContent}
            labelStyle={styles.createButtonLabel}
            loading={saving}
            disabled={saving}
          >
            {saving ? 'Saving session…' : 'Create session'}
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

  // ─── Location Toggle ───
  locationToggle: {
    marginBottom: 16,
  },

  // ─── Map Hint ───
  mapHint: {
    textAlign: 'center',
    marginBottom: 12,
    marginTop: -4,
    fontStyle: 'italic',
  },

  // ─── At Home Banner ───
  atHomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 4,
    gap: 12,
  },
  atHomeBannerContent: {
    flex: 1,
    gap: 2,
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
