import { WORKOUT_SUGGESTIONS } from '@/constants/workouts';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  Icon,
  IconButton,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import DrillTypeCarousel from './DrillTypeCarousel';
import WorkoutCarousel from './WorkoutCarousel';

// ─── Types ────────────────────────────────────────────────────

export type DrillCategory =
  | 'Warm-up'
  | 'Tactics'
  | 'Conditioning'
  | 'Scrimmage'
  | 'Cool-down';

export interface DrillItem {
  id: string;
  name: string;
  durationMinutes: number;
  category: DrillCategory;
  workouts?: string[];
}

interface DrillsEditorProps {
  drills: DrillItem[];
  onChangeDrills: (drills: DrillItem[]) => void;
}

// Category themes
export const CATEGORY_CONFIG: Record<
  DrillCategory,
  { label: string; icon: string; color: string; bgColor: string }
> = {
  'Warm-up': {
    label: 'Warm-up',
    icon: 'fire',
    color: '#E65100',
    bgColor: '#FFE0B2',
  },
  Tactics: {
    label: 'Tactics',
    icon: 'basketball',
    color: '#1565C0',
    bgColor: '#BBDEFB',
  },
  Conditioning: {
    label: 'Conditioning',
    icon: 'lightning-bolt',
    color: '#2E7D32',
    bgColor: '#C8E6C9',
  },
  Scrimmage: {
    label: 'Scrimmage',
    icon: 'whistle',
    color: '#6A1B9A',
    bgColor: '#E1BEE7',
  },
  'Cool-down': {
    label: 'Cool-down',
    icon: 'weather-windy',
    color: '#00838F',
    bgColor: '#B2EBF2',
  },
};

const CATEGORIES: DrillCategory[] = [
  'Warm-up',
  'Tactics',
  'Conditioning',
  'Scrimmage',
  'Cool-down',
];

export default function DrillsEditor({ drills, onChangeDrills }: DrillsEditorProps) {
  const theme = useTheme();
  const [collapseIds, setCollapsedIds] = useState<string[]>([]);

  const totalMinutes = drills.reduce((sum, d) => sum + (Number(d.durationMinutes) || 0), 0);

  const handleAddDrill = (
    name = '',
    durationMinutes = 15,
    category: DrillCategory = 'Tactics'
  ) => {
    const newDrill: DrillItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name,
      durationMinutes,
      category,
    };
    onChangeDrills([...drills, newDrill]);
  };

  const handleUpdateDrill = (id: string, updates: Partial<DrillItem>) => {
    onChangeDrills(
      drills.map((d) => (d.id === id ? { ...d, ...updates } : d))
    );
  };

  const handleRemoveDrill = (id: string) => {
    onChangeDrills(drills.filter((d) => d.id !== id));
  };

  const toggleWorkout = (drill: DrillItem, workoutName: string) => {
    const current = drill.workouts ?? [];
    const next = current.includes(workoutName)
      ? current.filter((w) => w !== workoutName)
      : [...current, workoutName];
    handleUpdateDrill(drill.id, { workouts: next });
  };

  const toggleSuggestions = (id: string) => {
    setCollapsedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const adjustDuration = (id: string, delta: number) => {
    const drill = drills.find((d) => d.id === id);
    if (!drill) return;
    const current = Number(drill.durationMinutes) || 0;
    const next = Math.max(1, Math.min(120, current + delta));
    handleUpdateDrill(id, { durationMinutes: next });
  };

  return (
    <View style={styles.container}>
      {/* ─── Summary Header Banner ─── */}
      <Surface
        style={[
          styles.summaryHeader,
          { backgroundColor: theme.colors.elevation.level2 },
        ]}
        elevation={0}
      >
        <View style={styles.summaryLeft}>
          <Icon source="clipboard-list-outline" size={20} color={theme.colors.primary} />
          <Text
            variant="labelLarge"
            style={{ color: theme.colors.onSurface, fontWeight: '700' }}
          >
            {drills.length} {drills.length === 1 ? 'Drill' : 'Drills'} planned
          </Text>
        </View>
        <Chip
          compact
          icon="clock-outline"
          style={{ backgroundColor: theme.colors.primaryContainer }}
          textStyle={{
            color: theme.colors.primary,
            fontWeight: '700',
            fontSize: 12,
          }}
        >
          {totalMinutes} min total
        </Chip>
      </Surface>

      {/* ─── Drills List ─── */}
      {drills.map((drill, index) => {
        const catConfig = CATEGORY_CONFIG[drill.category] || CATEGORY_CONFIG['Tactics'];
        const collapsed = collapseIds.includes(drill.id);

        return (
          <Surface
            key={drill.id}
            style={[
              styles.drillCard,
              {
                backgroundColor: theme.colors.elevation.level1,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
            elevation={0}
          >
            {/* Top row: Number, Category chip, Delete button */}
            <View style={styles.drillCardHeader}>
              <View style={styles.drillIndexBadge}>
                <Text
                  variant="labelSmall"
                  style={{ fontWeight: '700', color: theme.colors.onSurfaceVariant }}
                >
                  #{index + 1}
                </Text>
              </View>

              <View
                style={[
                  styles.categoryPill,
                  { backgroundColor: catConfig.bgColor },
                ]}
              >
                <Icon source={catConfig.icon} size={13} color={catConfig.color} />
                <Text
                  variant="labelSmall"
                  style={{
                    color: catConfig.color,
                    fontWeight: '700',
                    fontSize: 11,
                  }}
                >
                  {catConfig.label}
                </Text>
              </View>

              <View style={{ flex: 1 }} />

              <IconButton
                icon="trash-can-outline"
                size={18}
                iconColor={theme.colors.error}
                onPress={() => handleRemoveDrill(drill.id)}
                style={styles.deleteButton}
              />
            </View>
            {/* Category Selector Carousel */}
            <DrillTypeCarousel
              categories={CATEGORIES}
              config={CATEGORY_CONFIG}
              selected={drill.category}
              onSelect={(cat) => {
                // A new category means a new workout list, so clear the old picks
                handleUpdateDrill(drill.id, { category: cat, workouts: [] });
              }}
            />

            {/* Suggested workouts for the selected category */}
            <View style={styles.suggestionsBox}>
              <Pressable
                onPress={() => toggleSuggestions(drill.id)}
                style={styles.suggestionsHeader}
              >
                <Icon source="lightbulb-on-outline" size={16} color={catConfig.color} />
                <Text
                  variant="labelLarge"
                  style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '700' }}
                >
                  Suggested {catConfig.label} workouts
                </Text>
                {(drill.workouts?.length ?? 0) > 0 && (
                  <Text
                    variant="labelSmall"
                    style={{ color: catConfig.color, fontWeight: '700' }}
                  >
                    {drill.workouts?.length} selected
                  </Text>
                )}
                <Icon
                  source={collapsed ? 'chevron-down' : 'chevron-up'}
                  size={18}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>

              {!collapsed && (
                <WorkoutCarousel
                  category={drill.category}
                  workouts={WORKOUT_SUGGESTIONS[drill.category] || []}
                  picked={drill.workouts ?? []}
                  color={catConfig.color}
                  bgColor={catConfig.bgColor}
                  onToggle={(name) => toggleWorkout(drill, name)}
                />
              )}
            </View>

            {/* Duration Row with Steppers */}
            <View style={styles.durationRow}>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}
              >
                Duration:
              </Text>

              <View style={styles.durationControls}>
                <IconButton
                  icon="minus"
                  size={16}
                  mode="contained-tonal"
                  onPress={() => adjustDuration(drill.id, -5)}
                  style={styles.stepperButton}
                />

                <TextInput
                  mode="outlined"
                  value={String(drill.durationMinutes || '')}
                  onChangeText={(val) => {
                    const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
                    handleUpdateDrill(drill.id, {
                      durationMinutes: isNaN(num) ? 0 : num,
                    });
                  }}
                  keyboardType="numeric"
                  right={<TextInput.Affix text="min" />}
                  style={styles.durationInput}
                  outlineStyle={styles.durationOutline}
                  dense
                />

                <IconButton
                  icon="plus"
                  size={16}
                  mode="contained-tonal"
                  onPress={() => adjustDuration(drill.id, 5)}
                  style={styles.stepperButton}
                />
              </View>

              {/* Quick duration presets */}
              <View style={styles.presetsRow}>
                {[5, 10, 15, 20, 30, 45].map((preset) => {
                  const isSelected = drill.durationMinutes === preset;
                  return (
                    <Pressable
                      key={preset}
                      onPress={() =>
                        handleUpdateDrill(drill.id, { durationMinutes: preset })
                      }
                      style={[
                        styles.presetButton,
                        {
                          backgroundColor: isSelected
                            ? theme.colors.primaryContainer
                            : theme.colors.elevation.level2,
                          borderColor: isSelected
                            ? theme.colors.primary
                            : theme.colors.outlineVariant,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetButtonText,
                          {
                            color: isSelected
                              ? theme.colors.primary
                              : theme.colors.onSurfaceVariant,
                            fontWeight: isSelected ? '700' : '600',
                          },
                        ]}
                      >
                        {preset}m
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Surface>
        );
      })}

      {/* ─── Empty State ─── */}
      {drills.length === 0 && (
        <Surface
          style={[
            styles.emptyState,
            {
              backgroundColor: theme.colors.elevation.level1,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
          elevation={0}
        >
          <Icon source="clipboard-text-outline" size={32} color={theme.colors.primary} />
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurface, fontWeight: '700' }}
          >
            No drills added yet
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
          >
            Add as many or as few custom drills as needed for this session. Set individual durations and categories for each.
          </Text>
        </Surface>
      )}

      {/* ─── Add Custom Drill Button ─── */}
      <Button
        mode="contained-tonal"
        icon="plus"
        onPress={() => handleAddDrill('', 15, 'Warm-up')}
        style={styles.addCustomButton}
        contentStyle={{ paddingVertical: 6 }}
        labelStyle={{ fontWeight: '700' }}
      >
        Add drill
      </Button>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: 12,
    marginBottom: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 4,
  },
  summaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drillCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  drillCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drillIndexBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  deleteButton: {
    margin: 0,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  categoryPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  categoryPillText: {
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  suggestionsBox: {
    gap: 6,
    marginTop: 4,
  },
  suggestionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  workoutRight: {
    alignItems: 'center',
    gap: 2,
  },
  durationRow: {
    marginTop: 6,
    gap: 8,
  },
  durationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperButton: {
    margin: 0,
    width: 34,
    height: 34,
  },
  durationInput: {
    width: 105,
    backgroundColor: 'transparent',
    height: 44,
  },
  durationOutline: {
    borderRadius: 8,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  presetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetButtonText: {
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 4,
  },
  addCustomButton: {
    borderRadius: 14,
    marginTop: 6,
  },
});
