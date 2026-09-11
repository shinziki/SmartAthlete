import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface ReadinessRingProps {
  /** 0–100 readiness percentage */
  value: number;
  /** Size of the ring in dp */
  size?: number;
  /** Stroke width of the ring */
  strokeWidth?: number;
  /** Label shown inside the ring (e.g. "Moderate") */
  label: string;
  /** Sublabel shown below the label (e.g. "decision support") */
  sublabel?: string;
}

export default function ReadinessRing({
  value,
  size = 160,
  strokeWidth = 14,
  label,
  sublabel,
}: ReadinessRingProps) {
  const theme = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedValue = Math.max(0, Math.min(100, value));
  const strokeDashoffset = circumference - (clampedValue / 100) * circumference;
  const center = size / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={theme.colors.primary} />
            <Stop offset="70%" stopColor="#2E9B6B" />
            <Stop offset="100%" stopColor="#E8963E" />
          </LinearGradient>
        </Defs>

        {/* Background track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={theme.colors.surfaceVariant}
          strokeWidth={strokeWidth}
          fill="none"
          opacity={0.4}
        />

        {/* Progress arc */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="url(#ringGradient)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      </Svg>

      {/* Center labels */}
      <View style={styles.labelContainer}>
        <Text
          variant="titleLarge"
          style={[styles.label, { color: theme.colors.onSurface }]}
        >
          {label}
        </Text>
        {sublabel && (
          <Text
            variant="bodySmall"
            style={[styles.sublabel, { color: theme.colors.onSurfaceVariant }]}
          >
            {sublabel}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
    fontSize: 18,
  },
  sublabel: {
    fontSize: 11,
    marginTop: 2,
  },
});
