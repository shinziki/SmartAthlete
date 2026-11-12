import { ACWR_LEGEND, ACWR_SHORT_LABELS, getAcwrZone } from '@/lib/workload';
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

// ─── Colored status pill: "ACWR 1.12 · Optimal" ──────────────

interface AcwrPillProps {
    acwr: number | null;
    /** Slightly smaller text, for use inside cards */
    compact?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function AcwrPill({ acwr, compact = false, style }: AcwrPillProps) {
    if (acwr === null) return null;
    const zone = getAcwrZone(acwr);

    return (
        <View
            style={[
                styles.pill,
                { backgroundColor: zone.color + '22', borderColor: zone.color },
                style,
            ]}
        >
            <View style={[styles.dot, { backgroundColor: zone.color }]} />
            <Text style={{ color: zone.color, fontSize: compact ? 11 : 12, fontWeight: '700' }}>
                ACWR {acwr.toFixed(2)} · {ACWR_SHORT_LABELS[zone.key]}
            </Text>
        </View>
    );
}

// ─── Legend: blue / green / orange / red with their ranges ───

export default function AcwrLegend() {
    const theme = useTheme();

    return (
        <View style={styles.legendRow}>
            {ACWR_LEGEND.map((z) => (
                <View key={z.label} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: z.color }]} />
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {z.label} {z.range}
                    </Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 12,
        marginTop: 12,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});