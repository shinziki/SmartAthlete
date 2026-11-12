import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';

// ─── Types ────────────────────────────────────────────────────

interface CategoryLook {
    label: string;
    icon: string;
    color: string;
    bgColor: string;
}

interface DrillTypeCarouselProps<T extends string> {
    categories: T[];
    config: Record<T, CategoryLook>;
    selected: T;
    onSelect: (category: T) => void;
}

// ─── Sizing ───────────────────────────────────────────────────

const CARD_WIDTH = 108;
const CARD_GAP = 10;
const SNAP = CARD_WIDTH + CARD_GAP; // distance between two card left edges

// How long one animation cycle lasts for each drill type (ms)
const CYCLE_MS: Record<string, number> = {
    'Warm-up': 700,
    Tactics: 380, // one half of a bounce (down or up)
    Conditioning: 650,
    Scrimmage: 1100,
    'Cool-down': 2600,
};

// ─── Animation loop builder ───────────────────────────────────

function buildLoop(category: string, t: Animated.Value) {
    // Tactics: a real bounce. Fall with ease-in, rise with ease-out.
    if (category === 'Tactics') {
        return Animated.loop(
            Animated.sequence([
                Animated.timing(t, {
                    toValue: 1,
                    duration: CYCLE_MS.Tactics,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(t, {
                    toValue: 0,
                    duration: CYCLE_MS.Tactics,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
            ])
        );
    }

    // Everything else: t runs 0 -> 1 in a straight line, then restarts
    return Animated.loop(
        Animated.timing(t, {
            toValue: 1,
            duration: CYCLE_MS[category] ?? 800,
            easing: Easing.linear,
            useNativeDriver: true,
        })
    );
}

// ─── The little animated scene inside each card ───────────────

function DrillMotion({
    category,
    icon,
    color,
    active,
}: {
    category: string;
    icon: string;
    color: string;
    active: boolean;
}) {
    const t = useRef(new Animated.Value(0)).current;

    // Only the selected card animates (saves battery, and draws the eye)
    useEffect(() => {
        t.setValue(0);
        if (!active) return;
        const loop = buildLoop(category, t);
        loop.start();
        return () => {
            loop.stop();
            t.setValue(0);
        };
    }, [active, category, t]);

    const map = (input: number[], output: number[] | string[]) =>
        t.interpolate({ inputRange: input, outputRange: output });

    const glyph = <Icon source={icon} size={32} color={color} />;

    // 🏀 Tactics: bouncing ball with squash and a shadow on the floor
    if (category === 'Tactics') {
        return (
            <View style={styles.stage}>
                <Animated.View
                    style={{
                        transform: [
                            { translateY: map([0, 1], [-6, 8]) },
                            { scaleY: map([0, 0.9, 1], [1, 1, 0.8]) },
                            { scaleX: map([0, 0.9, 1], [1, 1, 1.15]) },
                        ],
                    }}
                >
                    {glyph}
                </Animated.View>
                <Animated.View
                    style={[
                        styles.shadow,
                        {
                            backgroundColor: color,
                            opacity: map([0, 1], [0.1, 0.35]),
                            transform: [{ scaleX: map([0, 1], [0.5, 1]) }],
                        },
                    ]}
                />
            </View>
        );
    }

    // 🔥 Warm-up: a flickering flame
    if (category === 'Warm-up') {
        return (
            <View style={styles.stage}>
                <Animated.View
                    style={{
                        transform: [
                            { translateY: map([0, 0.5, 1], [0, -3, 0]) },
                            { scale: map([0, 0.25, 0.5, 0.75, 1], [1, 1.18, 1.05, 1.2, 1]) },
                            {
                                rotate: map(
                                    [0, 0.25, 0.5, 0.75, 1],
                                    ['-4deg', '4deg', '-3deg', '5deg', '-4deg']
                                ),
                            },
                        ],
                    }}
                >
                    {glyph}
                </Animated.View>
            </View>
        );
    }

    // ⚡ Conditioning: a jittery bolt with speed lines streaking behind it
    if (category === 'Conditioning') {
        return (
            <View style={styles.stage}>
                {[14, 24, 34].map((top, i) => {
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
                <Animated.View
                    style={{
                        transform: [
                            { translateX: map([0, 0.1, 0.2, 0.3, 0.4, 1], [0, -2, 2, -2, 2, 0]) },
                            { scale: map([0, 0.5, 1], [1, 1.25, 1]) },
                        ],
                    }}
                >
                    {glyph}
                </Animated.View>
            </View>
        );
    }

    // 📣 Scrimmage: a wobbling whistle with a sound ring expanding outward
    if (category === 'Scrimmage') {
        return (
            <View style={styles.stage}>
                <Animated.View
                    style={[
                        styles.ring,
                        {
                            borderColor: color,
                            opacity: map([0, 1], [0.7, 0]),
                            transform: [{ scale: map([0, 1], [0.6, 1.7]) }],
                        },
                    ]}
                />
                <Animated.View
                    style={{
                        transform: [
                            {
                                rotate: map(
                                    [0, 0.25, 0.5, 0.75, 1],
                                    ['0deg', '-14deg', '0deg', '14deg', '0deg']
                                ),
                            },
                        ],
                    }}
                >
                    {glyph}
                </Animated.View>
            </View>
        );
    }

    // 🌬️ Cool-down (and any future type): slow breathing and a gentle drift
    return (
        <View style={styles.stage}>
            <Animated.View
                style={{
                    opacity: map([0, 0.5, 1], [0.7, 1, 0.7]),
                    transform: [
                        { translateX: map([0, 0.5, 1], [-5, 5, -5]) },
                        { scale: map([0, 0.5, 1], [1, 1.15, 1]) },
                    ],
                }}
            >
                {glyph}
            </Animated.View>
        </View>
    );
}

// ─── One card in the carousel ─────────────────────────────────

function CategoryCard({
    category,
    look,
    isSelected,
    scrollScale,
    onPress,
}: {
    category: string;
    look: CategoryLook;
    isSelected: boolean;
    scrollScale: Animated.AnimatedInterpolation<number>;
    onPress: () => void;
}) {
    const theme = useTheme();
    const pop = useRef(new Animated.Value(1)).current;

    // Springy "pop" every time this card becomes the selected one
    useEffect(() => {
        if (!isSelected) return;
        pop.setValue(0.9);
        Animated.spring(pop, {
            toValue: 1,
            friction: 4,
            tension: 160,
            useNativeDriver: true,
        }).start();
    }, [isSelected, pop]);

    return (
        <Animated.View
            style={{ transform: [{ scale: Animated.multiply(scrollScale, pop) }] }}
        >
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={[
                    styles.card,
                    {
                        backgroundColor: isSelected ? look.bgColor : theme.colors.surface,
                        borderColor: isSelected ? look.color : theme.colors.outlineVariant,
                    },
                ]}
            >
                <DrillMotion
                    category={category}
                    icon={look.icon}
                    color={isSelected ? look.color : theme.colors.onSurfaceVariant}
                    active={isSelected}
                />
                <Text
                    style={[
                        styles.cardLabel,
                        {
                            color: isSelected ? look.color : theme.colors.onSurfaceVariant,
                            fontWeight: isSelected ? '700' : '500',
                        },
                    ]}
                >
                    {look.label}
                </Text>
            </Pressable>
        </Animated.View>
    );
}

// ─── The carousel ─────────────────────────────────────────────

export default function DrillTypeCarousel<T extends string>({
    categories,
    config,
    selected,
    onSelect,
}: DrillTypeCarouselProps<T>) {
    const scrollX = useRef(new Animated.Value(0)).current;
    const listRef = useRef<any>(null);
    const selectedIndex = categories.indexOf(selected);

    // Slide the chosen card into view whenever the selection changes
    useEffect(() => {
        listRef.current?.scrollTo({
            x: Math.max(0, selectedIndex) * SNAP,
            animated: true,
        });
    }, [selectedIndex]);

    return (
        <Animated.ScrollView
            ref={listRef}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={SNAP}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                { useNativeDriver: true }
            )}
            contentContainerStyle={styles.content}
        >
            {categories.map((cat, i) => {
                // Card is full size at the left edge and shrinks slightly as it scrolls away
                const scrollScale = scrollX.interpolate({
                    inputRange: [(i - 1) * SNAP, i * SNAP, (i + 1) * SNAP],
                    outputRange: [0.92, 1, 0.92],
                    extrapolate: 'clamp',
                });

                return (
                    <CategoryCard
                        key={cat}
                        category={cat}
                        look={config[cat]}
                        isSelected={cat === selected}
                        scrollScale={scrollScale}
                        onPress={() => {
                            if (cat !== selected) {
                                Haptics.selectionAsync();
                                onSelect(cat);
                            }
                        }}
                    />
                );
            })}
        </Animated.ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
    content: {
        gap: CARD_GAP,
        paddingVertical: 6,
        paddingRight: 4,
    },
    card: {
        width: CARD_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 16,
        borderWidth: 1.5,
        gap: 4,
    },
    cardLabel: {
        fontSize: 12,
        lineHeight: 16,
        includeFontPadding: false,
    },
    stage: {
        width: 56,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
    },
    shadow: {
        position: 'absolute',
        bottom: 0,
        width: 30,
        height: 5,
        borderRadius: 3,
    },
    speedLine: {
        position: 'absolute',
        left: 2,
        width: 9,
        height: 3,
        borderRadius: 2,
    },
    ring: {
        position: 'absolute',
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 2,
    },
});