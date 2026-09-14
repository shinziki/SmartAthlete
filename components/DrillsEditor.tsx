import React from 'react';
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

            {/* Drill Name Input */}
            <TextInput
              mode="outlined"
              label="Drill title"
              placeholder="e.g. Full-court transition drill"
              value={drill.name}
              onChangeText={(text) => handleUpdateDrill(drill.id, { name: text })}
              style={styles.drillInput}
              outlineStyle={styles.drillInputOutline}
            />

            {/* Category Selector Pills */}
            <View style={styles.categoryRow}>
              {CATEGORIES.map((cat) => {
                const isSelected = drill.category === cat;
                const catConfig = CATEGORY_CONFIG[cat];
                return (
                  <Pressable
                    key={cat}
                    onPress={() => handleUpdateDrill(drill.id, { category: cat })}
                    style={[
                      styles.categoryPillButton,
                      {
                        backgroundColor: isSelected
                          ? catConfig.bgColor
                          : theme.colors.surface,
                        borderColor: isSelected
                          ? catConfig.color
                          : theme.colors.outlineVariant,
                      },
                    ]}
                  >
                    <Icon
                      source={catConfig.icon}
                      size={14}
                      color={isSelected ? catConfig.color : theme.colors.onSurfaceVariant}
                    />
                    <Text
                      style={[
                        styles.categoryPillText,
                        {
                          color: isSelected
                            ? catConfig.color
                            : theme.colors.onSurfaceVariant,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                    >
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
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
  drillInput: {
    backgroundColor: 'transparent',
  },
  drillInputOutline: {
    borderRadius: 10,
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
