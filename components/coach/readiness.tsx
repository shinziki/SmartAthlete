import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Readiness } from '@/lib/coachService';

export const READINESS_COLORS: Record<Readiness, { fg: string; bg: string; label: string }> = {
  ready: { fg: '#34D399', bg: 'rgba(52, 211, 153, 0.15)', label: 'Ready' },
  moderate: { fg: '#FBBF24', bg: 'rgba(251, 191, 36, 0.15)', label: 'Moderate' },
  watch: { fg: '#F87171', bg: 'rgba(248, 113, 113, 0.15)', label: 'Watch' },
  nodata: { fg: '#9CA3AF', bg: 'rgba(156, 163, 175, 0.15)', label: 'No data' },
};

export function ReadinessPill({ status }: { status: Readiness }) {
  const c = READINESS_COLORS[status];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

export function InitialsAvatar({
  initials,
  size = 44,
  color,
}: {
  initials: string;
  size?: number;
  color: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.34 }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
