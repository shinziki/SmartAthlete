import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';
import { WorkoutMotionKind, WorkoutSuggestion } from '@/constants/workouts';

// ─── Types ────────────────────────────────────────────────────

type Workout = WorkoutSuggestion;
type MotionKind = WorkoutMotionKind;

interface WorkoutCarouselProps {
    category: string;
    workouts: Workout[];
    picked: string[];
    color: string;
    bgColor: string;
    onToggle: (workoutName: string) => void;
}

// How long one cycle of each motion lasts (ms)
const CYCLE_MS: Record<MotionKind, number> = {
    jog: 600,
    wobble: 900,
    hop: 420, // one half (up or down)
    slide: 1000,
    sprint: 600,
    pulse: 1400,
    press: 1300,
};

// ─── Sizing ───────────────────────────────────────────────────

const CARD_WIDTH = 184;
const CARD_GAP = 10;
const SNAP = CARD_WIDTH + CARD_GAP;

// ─── Animation loop builder ───────────────────────────────────

function buildLoop(kind: MotionKind, t: Animated.Value) {
    // Hop: t=0 is the ground. Push up with ease-out, fall with ease-in.
    if (kind === 'hop') {
        return Animated.loop(
            Animated.sequence([
                Animated.timing(t, {
                    toValue: 1,
                    duration: CYCLE_MS.hop,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(t, {
                    toValue: 0,
                    duration: CYCLE_MS.hop,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
            ])
        );
    }

    // Everything else: t runs 0 -> 1 in a straight line, then restarts
    return Animated.loop(
        Animated.timing(t, {
            toValue: 1,
            duration: CYCLE_MS[kind],
            easing: Easing.linear,
            useNativeDriver: true,
        })
    );
}

// ─── The little animated scene on each card ───────────────────

function WorkoutMotion({
    icon,
    kind,
    color,
    active,
}: {
    icon: string;
    kind: MotionKind;
    color: string;
    active: boolean;
}) {
    const t = useRef(new Animated.Value(0)).current;

    // Only picked workouts animate
    useEffect(() => {
        t.setValue(0);
        if (!active) return;
        const loop = buildLoop(kind, t);
        loop.start();
        return () => {
            loop.stop();
            t.setValue(0);
        };
    }, [active, kind, t]);

    const map = (input: number[], output: number[] | string[]) =>
        t.interpolate({ inputRange: input, outputRange: output });

    // What moves the icon, what extra decoration sits behind it
    let transform: any[] = [];
    let opacity: Animated.AnimatedInterpolation<number> | number = 1;
    let extra: React.ReactNode = null;

    switch (kind) {
        case 'jog':
            transform = [
                { translateX: map([0, 0.5, 1], [-6, 6, -6]) },
                { translateY: map([0, 0.25, 0.5, 0.75, 1], [0, -4, 0, -4, 0]) },
            ];
            break;

        case 'wobble':
            transform = [
                { rotate: map([0, 0.5, 1], ['-12deg', '12deg', '-12deg']) },
                { scale: map([0, 0.5, 1], [1, 1.12, 1]) },
            ];
            break;

        case 'hop':
            transform = [
                { translateY: map([0, 1], [0, -12]) },
                { scaleY: map([0, 0.1, 1], [0.8, 1, 1]) },
                { scaleX: map([0, 0.1, 1], [1.15, 1, 1]) },
            ];
            extra = (
                <Animated.View
                    style={[
                        styles.shadow,
                        {
                            backgroundColor: color,
                            opacity: map([0, 1], [0.35, 0.1]),
                            transform: [{ scaleX: map([0, 1], [1, 0.5]) }],
                        },
                    ]}
                />
            );
            break;

        case 'slide':
            transform = [
                { translateX: map([0, 0.5, 1], [-12, 12, -12]) },
                {
                    rotate: map(
                        [0, 0.25, 0.5, 0.75, 1],
                        ['-6deg', '0deg', '6deg', '0deg', '-6deg']
                    ),
                },
            ];
            break;

        case 'sprint':
            transform = [
                { translateX: map([0, 0.1, 0.2, 0.3, 0.4, 1], [0, -2, 2, -2, 2, 0]) },
                { scale: map([0, 0.5, 1], [1, 1.2, 1]) },
            ];
            extra = (
                <>
                    {[12, 21, 30].map((top, i) => {
                        const start = 0.05 + i * 0.15;
                        return (
                            <Animated.View
                                key={top}
                                style={[
                                    styles.speedLine,
                                    {
                                        top,
                                        backgroundColor: color,
                                        opacity: map([0, start, start + 0.2, 1], [0, 0, 1, 0]),
                                        transform: [{ translateX: map([0, 1], [4, -6]) }],
                                    },
                                ]}
                            />
                        );
                    })}
                </>
            );
            break;

        case 'pulse':
            transform = [{ scale: map([0, 0.5, 1], [1, 1.2, 1]) }];
            opacity = map([0, 0.5, 1], [0.7, 1, 0.7]);
            break;

        // Down and back up, like a push-up or squat rep
        case 'press':
            transform = [
                { translateY: map([0, 0.5, 1], [-5, 7, -5]) },
                { scaleY: map([0, 0.5, 1], [1, 0.85, 1]) },
            ];
            break;
    }

    return (
        <View style={styles.stage}>
            {extra}
            <Animated.View style={{ opacity, transform }}>
                <Icon source={icon} size={28} color={color} />
            </Animated.View>
        </View>
    );
}

// ─── One workout card ─────────────────────────────────────────

function WorkoutCard({
    workout,
    index,
    isPicked,
    color,
    bgColor,
    onPress,
}: {
    workout: Workout;
    index: number;
    isPicked: boolean;
    color: string;
    bgColor: string;
    onPress: () => void;
}) {
    const theme = useTheme();
    const enter = useRef(new Animated.Value(0)).current;
    const pop = useRef(new Animated.Value(1)).current;

    // Entrance: each card slides in from the right, one after another
    useEffect(() => {
        Animated.timing(enter, {
            toValue: 1,
            duration: 320,
            delay: index * 70,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enter, index]);

    // Springy pop when the card gets picked
    useEffect(() => {
        if (!isPicked) return;
        pop.setValue(0.94);
        Animated.spring(pop, {
            toValue: 1,
            friction: 4,
            tension: 160,
            useNativeDriver: true,
        }).start();
    }, [isPicked, pop]);

    const tone = isPicked ? color : theme.colors.onSurfaceVariant;

    return (
        <Animated.View
            style={{
                opacity: enter,
                transform: [
                    { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
                    { scale: pop },
                ],
            }}
        >
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityState={{ selected: isPicked }}
                style={[
                    styles.card,
                    {
                        backgroundColor: isPicked ? bgColor : theme.colors.surface,
                        borderColor: isPicked ? color : theme.colors.outlineVariant,
                    },
                ]}
            >
                <View style={styles.cardTop}>
                    <WorkoutMotion
                        icon={workout.icon}
                        kind={workout.motion}
                        color={tone}
                        active={isPicked}
                    />
                    <View style={{ flex: 1 }} />
                    <Icon
                        source={isPicked ? 'check-circle' : 'plus-circle-outline'}
                        size={22}
                        color={tone}
                    />
                </View>

                <Text
                    variant="bodyMedium"
                    numberOfLines={2}
                    style={{ fontWeight: '700', color: isPicked ? color : theme.colors.onSurface }}
                >
                    {workout.name}
                </Text>
                <Text variant="bodySmall" numberOfLines={4} style={{ color: tone }}>
                    {workout.description}
                </Text>

                <View style={{ flex: 1 }} />

                <View style={styles.cardBottom}>
                    <Icon source="clock-outline" size={14} color={tone} />
                    <Text variant="labelSmall" style={{ color: tone }}>
                        ~{workout.minutes} min
                    </Text>
                </View>
            </Pressable>
        </Animated.View>
    );
}

// ─── The carousel ─────────────────────────────────────────────

export default function WorkoutCarousel({
    category,
    workouts,
    picked,
    color,
    bgColor,
    onToggle,
}: WorkoutCarouselProps) {
    return (
        <ScrollView
            // New key per category: the list jumps back to the start and cards re-enter
            key={category}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={SNAP}
            decelerationRate="fast"
            contentContainerStyle={styles.content}
        >
            {workouts.map((w, i) => (
                <WorkoutCard
                    key={w.name}
                    workout={w}
                    index={i}
                    isPicked={picked.includes(w.name)}
                    color={color}
                    bgColor={bgColor}
                    onPress={() => {
                        Haptics.selectionAsync();
                        onToggle(w.name);
                    }}
                />
            ))}
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
    content: {
        gap: CARD_GAP,
        paddingVertical: 4,
        paddingRight: 4,
    },
    card: {
        width: CARD_WIDTH,
        minHeight: 168,
        borderWidth: 1.5,
        borderRadius: 16,
        padding: 12,
        gap: 6,
    },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cardBottom: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    stage: {
        width: 52,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
    },
    shadow: {
        position: 'absolute',
        bottom: 0,
        width: 26,
        height: 4,
        borderRadius: 2,
    },
    speedLine: {
        position: 'absolute',
        left: 2,
        width: 9,
        height: 3,
        borderRadius: 2,
    },
});