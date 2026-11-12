import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Divider, IconButton, List, Text, useTheme } from 'react-native-paper';

/** Small uppercase label shown above a group of menu rows. */
export function GroupLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      variant="labelMedium"
      style={[styles.groupLabel, { color: theme.colors.onSurfaceVariant }]}
    >
      {children.toUpperCase()}
    </Text>
  );
}

/** A rounded card that holds several MenuRows separated by dividers. */
export function MenuGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  const theme = useTheme();
  const rows = React.Children.toArray(children);
  return (
    <View style={styles.groupWrap}>
      {label ? <GroupLabel>{label}</GroupLabel> : null}
      <Card mode="elevated" style={{ borderRadius: 24, backgroundColor: theme.colors.elevation.level1 }}>
        <Card.Content style={styles.groupContent}>
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <Divider /> : null}
              {row}
            </React.Fragment>
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}

/** A tappable row (icon, title, short subtitle, chevron) that opens a profile section. */
export function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <List.Item
      title={title}
      description={subtitle}
      descriptionNumberOfLines={1}
      left={(p) => <List.Icon {...p} icon={icon} />}
      right={(p) => <List.Icon {...p} icon="chevron-right" />}
      onPress={onPress}
      style={styles.row}
    />
  );
}

/** Header shown on a section page: back button + title. */
export function SectionHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <IconButton
        icon="arrow-left"
        mode="contained-tonal"
        onPress={onBack}
        accessibilityLabel="Back to profile"
      />
      <Text variant="headlineSmall" style={{ color: theme.colors.onBackground, fontWeight: '700' }}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  groupWrap: { gap: 8 },
  groupLabel: { letterSpacing: 0.8, fontWeight: '700', marginLeft: 8 },
  groupContent: { paddingVertical: 4, paddingHorizontal: 4 },
  row: { paddingVertical: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
});

