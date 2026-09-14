import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Icon, Surface, Text, useTheme } from 'react-native-paper';
import { DrillItem, CATEGORY_CONFIG } from './DrillsEditor';

interface TrainingRegimeViewProps {
  drills: DrillItem[];
  title?: string;
}

export default function TrainingRegimeView({
  drills,
  title = "Today's Training Regime",
}: TrainingRegimeViewProps) {
  const theme = useTheme();

  const totalMinutes = drills.reduce(
    (sum, d) => sum + (Number(d.durationMinutes) || 0),
    0
  );

  return (
    <Surface
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.elevation.level1,
          borderColor: theme.colors.outlineVariant,
        },
      ]}
      elevation={0}
    >
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Icon source="dumbbell" size={20} color={theme.colors.primary} />
          <Text
            variant="titleMedium"
            style={{ color: theme.colors.onSurface, fontWeight: '700' }}
          >
            {title}
          </Text>
        </View>

        <View style={styles.headerChips}>
          <Chip
            compact
            icon="clock-outline"
            style={{ backgroundColor: theme.colors.primaryContainer }}
            textStyle={{
              color: theme.colors.primary,
              fontWeight: '700',
              fontSize: 11,
            }}
          >
            {totalMinutes} min
          </Chip>
          <Chip
            compact
            style={{ backgroundColor: theme.colors.elevation.level2 }}
            textStyle={{
              color: theme.colors.onSurfaceVariant,
              fontWeight: '600',
              fontSize: 11,
            }}
          >
            {drills.length} drills
          </Chip>
        </View>
      </View>

      {/* ─── Drills Timeline List ─── */}
      {drills.length === 0 ? (
        <View style={{ paddingVertical: 12, alignItems: 'center' }}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            No specific drills configured for this session yet.
          </Text>
        </View>
      ) : (
        <View style={styles.drillsList}>
          {drills.map((drill, index) => {
          const isLast = index === drills.length - 1;
          const cat = CATEGORY_CONFIG[drill.category] || CATEGORY_CONFIG['Tactics'];

          return (
            <View key={drill.id || index} style={styles.timelineItem}>
              {/* Left Timeline Indicator */}
              <View style={styles.timelineLeft}>
                <View
                  style={[
                    styles.timelineDot,
                    { backgroundColor: cat.color },
                  ]}
                >
                  <Text style={styles.timelineDotText}>{index + 1}</Text>
                </View>
                {!isLast && (
                  <View
                    style={[
                      styles.timelineLine,
                      { backgroundColor: theme.colors.outlineVariant },
                    ]}
                  />
                )}
              </View>

              {/* Drill Content Card */}
              <View
                style={[
                  styles.drillContent,
                  { backgroundColor: theme.colors.elevation.level2 },
                ]}
              >
                <View style={styles.drillMainRow}>
                  <Text
                    variant="bodyMedium"
                    style={{
                      color: theme.colors.onSurface,
                      fontWeight: '600',
                      flex: 1,
                    }}
                  >
                    {drill.name}
                  </Text>
                  <View
                    style={[
                      styles.durationBadge,
                      { backgroundColor: theme.colors.surface },
                    ]}
                  >
                    <Icon
                      source="clock-outline"
                      size={13}
                      color={theme.colors.primary}
                    />
                    <Text
                      variant="labelSmall"
                      style={{
                        color: theme.colors.primary,
                        fontWeight: '700',
                        fontSize: 11,
                      }}
                    >
                      {drill.durationMinutes}m
                    </Text>
                  </View>
                </View>

                {/* Category tag */}
                <View style={styles.drillSubRow}>
                  <View
                    style={[
                      styles.categoryTag,
                      { backgroundColor: cat.bgColor },
                    ]}
                  >
                    <Icon source={cat.icon} size={11} color={cat.color} />
                    <Text
                      style={{
                        color: cat.color,
                        fontSize: 10,
                        fontWeight: '700',
                      }}
                    >
                      {cat.label}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>
      )}
    </Surface>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerChips: {
    flexDirection: 'row',
    gap: 6,
  },
  drillsList: {
    gap: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 24,
  },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 38,
    marginVertical: 4,
  },
  drillContent: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 4,
  },
  drillMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  drillSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  categoryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
});
