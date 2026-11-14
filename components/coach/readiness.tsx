import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Readiness } from '@/lib/coachService';
import { Icon } from 'react-native-paper';
import { athleteSyncState, SessionProgress } from '@/lib/sessionService';

const LIVE_STYLE = {
  live: { icon: 'access-point', fg: '#1D4ED8', bg: '#DBEAFE', label: 'Live' },
  pending: { icon: 'cloud-sync-outline', fg: '#92400E', bg: '#FEF3C7', label: 'Pending sync' },
  synced: { icon: 'cloud-check-outline', fg: '#2E7D32', bg: '#DCFCE7', label: 'Synced' },
  near_edge: { icon: 'map-marker-alert-outline', fg: '#92400E', bg: '#FEF3C7', label: 'Near edge' },
  outside: { icon: 'map-marker-off-outline', fg: '#B91C1C', bg: '#FEE2E2', label: 'Outside venue' },
  stopped: { icon: 'stop-circle-outline', fg: '#7F1D1D', bg: '#FECACA', label: 'Stopped · left venue' },
};

/**
 * Athlete's status in a running session: Live / Pending sync / Synced, and the venue
 * boundary (near edge / outside) while live.
 */
export function LiveStatusPill({ progress }: { progress: SessionProgress }) {
  const sync = athleteSyncState(progress);
  const b = progress.boundaryStatus;
  const key =
    b === 'stopped'
      ? 'stopped'
      : sync === 'live' && (b === 'outside' || b === 'near_edge')
      ? b
      : sync;
  const c = LIVE_STYLE[key];
  return (
    <View style={[styles.pill, styles.livePill, { backgroundColor: c.bg }]}>
      <Icon source={c.icon} size={11} color={c.fg} />
      <Text style={[styles.pillText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

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

/** Basketball-style jersey number; shows "—" when none is assigned. */
export function JerseyBadge({
  number,
  size = 'small',
  color,
}: {
  number: string | null;
  size?: 'small' | 'large';
  color: string;
}) {
  const large = size === 'large';
  return (
    <View
      style={[
        styles.jersey,
        large && styles.jerseyLarge,
        { borderColor: color, opacity: number ? 1 : 0.5 },
      ]}
    >
      <Text style={[styles.jerseyText, large && styles.jerseyTextLarge, { color }]}>
        {number ? `#${number}` : '#—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  jersey: {
    minWidth: 40,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  jerseyLarge: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 2,
  },
  jerseyText: {
    fontSize: 12,
    fontWeight: '800',
  },
  jerseyTextLarge: {
    fontSize: 22,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
