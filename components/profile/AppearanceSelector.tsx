import { ThemePreference, useThemePreference } from '@/lib/themePreference';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, SegmentedButtons, Text, useTheme } from 'react-native-paper';

/** Card with a System / Light / Dark selector. */
export default function AppearanceSelector() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();

  return (
    <View style={{ gap: 8 }}>
      <Text
        variant="labelMedium"
        style={[styles.label, { color: theme.colors.onSurfaceVariant }]}
      >
        APPEARANCE
      </Text>
      <Card
        mode="elevated"
        style={{ borderRadius: 24, backgroundColor: theme.colors.elevation.level1 }}
      >
        <Card.Content>
          <SegmentedButtons
            value={preference}
            onValueChange={(v) => setPreference(v as ThemePreference)}
            buttons={[
              { value: 'system', label: 'System', icon: 'cellphone' },
              { value: 'light', label: 'Light', icon: 'white-balance-sunny' },
              { value: 'dark', label: 'Dark', icon: 'weather-night' },
            ]}
          />
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { letterSpacing: 0.8, fontWeight: '700', marginLeft: 8 },
});

