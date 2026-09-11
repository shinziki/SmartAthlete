import React from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Button, Card, Chip, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';

// ─── Location Radar Visualization ────────────────────────────

function LocationRadar() {
  const theme = useTheme();
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={radarStyles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background fill */}
        <Rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={20}
          ry={20}
          fill={theme.colors.primaryContainer}
          opacity={0.25}
        />

        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <React.Fragment key={fraction}>
            <Line
              x1={cx * fraction}
              y1={0}
              x2={cx * fraction}
              y2={size}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
            <Line
              x1={cx + cx * fraction}
              y1={0}
              x2={cx + cx * fraction}
              y2={size}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
            <Line
              x1={0}
              y1={cy * fraction}
              x2={size}
              y2={cy * fraction}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
            <Line
              x1={0}
              y1={cy + cy * fraction}
              x2={size}
              y2={cy + cy * fraction}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
          </React.Fragment>
        ))}

        {/* Dashed concentric circles (geofence rings) */}
        <Circle
          cx={cx}
          cy={cy}
          r={95}
          stroke={theme.colors.primary}
          strokeWidth={1.5}
          strokeDasharray="6,4"
          fill="none"
          opacity={0.4}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={60}
          stroke={theme.colors.primary}
          strokeWidth={1.5}
          strokeDasharray="6,4"
          fill="none"
          opacity={0.3}
        />

        {/* Inner zone fill */}
        <Circle
          cx={cx}
          cy={cy}
          r={60}
          fill={theme.colors.primary}
          opacity={0.08}
        />

        {/* User location dot */}
        <Circle cx={cx} cy={cy - 8} r={10} fill="#E8763E" opacity={0.9} />
        <Circle cx={cx} cy={cy - 8} r={5} fill="#F59E4E" />
      </Svg>

      {/* Venue label overlay */}
      <View
        style={[
          radarStyles.venueLabel,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant },
        ]}
      >
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 11 }}
        >
          EVSU Ormoc Gymnasium
        </Text>
      </View>
    </View>
  );
}

const radarStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  venueLabel: {
    position: 'absolute',
    bottom: 32,
    left: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
});

// ─── Main Screen ─────────────────────────────────────────────

export default function CheckInScreen() {
  const theme = useTheme();

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Page Title ─── */}
        <Text
          variant="headlineLarge"
          style={[styles.pageTitle, { color: theme.colors.onBackground }]}
        >
          Check In
        </Text>

        {/* ─── Session + Location Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.sessionCard,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content>
            {/* Session info */}
            <Text
              variant="titleMedium"
              style={{ color: theme.colors.onSurface, fontWeight: '700' }}
            >
              Strength & Conditioning
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
            >
              Today · 4:00–6:00 PM · EVSU Ormoc Gymnasium
            </Text>

            {/* Location radar */}
            <LocationRadar />

            {/* Status indicator */}
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: theme.colors.primary },
                ]}
              />
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '600' }}
              >
                Inside training venue
              </Text>
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginLeft: 6 }}
              >
                ± 6 m
              </Text>
            </View>
          </Card.Content>
        </Card>

        {/* ─── Check In Button ─── */}
        <Button
          mode="contained"
          style={styles.checkInButton}
          contentStyle={styles.checkInButtonContent}
          labelStyle={styles.checkInButtonLabel}
        >
          Check in now
        </Button>

        {/* ─── Disclaimer ─── */}
        <Text
          variant="bodySmall"
          style={[styles.disclaimer, { color: theme.colors.onSurfaceVariant }]}
        >
          Check-in opens 15 min before the session and records once.
        </Text>

        {/* ─── Window Status Card ─── */}
        <Card
          mode="outlined"
          style={[
            styles.windowCard,
            { borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Card.Content style={styles.windowCardContent}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '700' }}
            >
              Window status
            </Text>
            <Chip
              compact
              style={{ backgroundColor: theme.colors.primaryContainer }}
              textStyle={{
                color: theme.colors.primary,
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              Opens 3:45 PM
            </Chip>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
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

  // Session + Location card
  sessionCard: {
    borderRadius: 20,
  },

  // Status row
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // Check-in button
  checkInButton: {
    borderRadius: 16,
    marginTop: 4,
  },
  checkInButtonContent: {
    height: 56,
  },
  checkInButtonLabel: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Disclaimer
  disclaimer: {
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 20,
    paddingHorizontal: 16,
  },

  // Window status
  windowCard: {
    borderRadius: 16,
  },
  windowCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
