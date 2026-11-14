import { DrillCategory } from './regimes';

/**
 * Drills a coach can pick for each drill type.
 *
 * Every drill here is a simple movement the watch can measure by itself: the
 * drill type decides which watch sensors run (see CATEGORY_SENSOR_PROFILE in
 * sensorProfiles.ts), so only add a drill to a type whose sensors can track it.
 */

/** Animation used for the drill's card in WorkoutCarousel */
export type WorkoutMotionKind =
    | 'jog'
    | 'wobble'
    | 'hop'
    | 'slide'
    | 'sprint'
    | 'pulse'
    | 'press';

export interface WorkoutSuggestion {
    name: string;
    description: string;
    /** Rough time a coach might give it (a guide only; the coach sets the real duration) */
    minutes: number;
    icon: string;
    motion: WorkoutMotionKind;
}

export const WORKOUT_SUGGESTIONS: Record<DrillCategory, WorkoutSuggestion[]> = {
    // Step counter + heart rate
    'Warm-up': [
        {
            name: 'Brisk walk',
            description: 'Walk at a quick pace, swinging your arms naturally.',
            minutes: 3,
            icon: 'walk',
            motion: 'jog',
        },
        {
            name: 'Light jog',
            description: 'Easy jog at a pace where you can still talk.',
            minutes: 5,
            icon: 'run',
            motion: 'jog',
        },
        {
            name: 'High knees',
            description: 'Run on the spot or forward, lifting each knee to hip height.',
            minutes: 2,
            icon: 'run-fast',
            motion: 'jog',
        },
        {
            name: 'Butt kicks',
            description: 'Jog while kicking your heels up toward your glutes.',
            minutes: 2,
            icon: 'run',
            motion: 'jog',
        },
    ],

    // Step counter + cadence: distance, speed and heart rate
    Running: [
        {
            name: 'Steady run',
            description: 'Run at an even, moderate pace without stopping.',
            minutes: 10,
            icon: 'run',
            motion: 'jog',
        },
        {
            name: 'Tempo run',
            description: 'Run at a hard but controlled pace you can hold for the whole time.',
            minutes: 8,
            icon: 'run-fast',
            motion: 'sprint',
        },
        {
            name: 'Sprint intervals',
            description: 'Sprint for about 20 seconds, walk for 40 seconds, and repeat.',
            minutes: 8,
            icon: 'run-fast',
            motion: 'sprint',
        },
        {
            name: 'Shuttle runs',
            description: 'Sprint to a marker about 20 m away, touch the line and sprint back.',
            minutes: 6,
            icon: 'swap-horizontal',
            motion: 'sprint',
        },
        {
            name: 'Stair or hill runs',
            description: 'Run up a hill or a flight of stairs, then walk back down to recover.',
            minutes: 6,
            icon: 'stairs-up',
            motion: 'sprint',
        },
    ],

    // Accelerometer rep counting (steps off)
    Strength: [
        {
            name: 'Push-ups',
            description: 'Lower your chest to the floor and press back up with a straight body.',
            minutes: 3,
            icon: 'arm-flex',
            motion: 'press',
        },
        {
            name: 'Sit-ups',
            description: 'Arms crossed on your chest, sit all the way up and lower back down.',
            minutes: 3,
            icon: 'human',
            motion: 'press',
        },
        {
            name: 'Squats',
            description: 'Arms out in front, sit back until thighs are level, then stand up.',
            minutes: 3,
            icon: 'human-handsdown',
            motion: 'press',
        },
        {
            name: 'Lunges',
            description: 'Step forward and lower the back knee, alternating legs each rep.',
            minutes: 3,
            icon: 'walk',
            motion: 'press',
        },
        {
            name: 'Jumping jacks',
            description: 'Jump feet apart while raising your arms overhead, then back together.',
            minutes: 2,
            icon: 'human-handsup',
            motion: 'wobble',
        },
        {
            name: 'Burpees',
            description: 'Drop to a push-up position, jump your feet back in and stand up tall.',
            minutes: 3,
            icon: 'weight-lifter',
            motion: 'press',
        },
    ],

    // Accelerometer jump detection (take-off, flight, landing)
    Jumping: [
        {
            name: 'Vertical jumps',
            description: 'Jump straight up as high as you can, land softly and reset.',
            minutes: 3,
            icon: 'arrow-up-bold',
            motion: 'hop',
        },
        {
            name: 'Squat jumps',
            description: 'Drop into a squat, then explode upward into a jump.',
            minutes: 3,
            icon: 'human-male-height',
            motion: 'hop',
        },
        {
            name: 'Tuck jumps',
            description: 'Jump up and pull both knees toward your chest.',
            minutes: 2,
            icon: 'arrow-up-bold',
            motion: 'hop',
        },
        {
            name: 'Broad jumps',
            description: 'Jump forward as far as you can from two feet, then walk back.',
            minutes: 3,
            icon: 'arrow-right-bold',
            motion: 'hop',
        },
        {
            name: 'Skater jumps',
            description: 'Leap sideways from one foot to the other like a speed skater.',
            minutes: 3,
            icon: 'swap-horizontal',
            motion: 'hop',
        },
    ],

    // Accelerometer slide steps (sideways steps the step counter misses)
    Agility: [
        {
            name: 'Side shuffles',
            description: 'Shuffle sideways in a low stance without crossing your feet.',
            minutes: 3,
            icon: 'arrow-left-right',
            motion: 'slide',
        },
        {
            name: 'Carioca',
            description: 'Move sideways, crossing one foot in front and then behind the other.',
            minutes: 3,
            icon: 'swap-horizontal',
            motion: 'slide',
        },
        {
            name: 'Zig-zag shuffle',
            description: 'Shuffle diagonally between markers, changing direction at each one.',
            minutes: 4,
            icon: 'arrow-left-right',
            motion: 'slide',
        },
        {
            name: 'Line shuffle touches',
            description: 'Shuffle between two lines about 5 m apart, touching each line.',
            minutes: 4,
            icon: 'arrow-left-right',
            motion: 'slide',
        },
    ],

    // Heart-rate recovery + step counter
    'Cool-down': [
        {
            name: 'Easy walk',
            description: 'Walk slowly to bring your heart rate down gradually.',
            minutes: 3,
            icon: 'walk',
            motion: 'jog',
        },
        {
            name: 'Static stretching',
            description: 'Hold each stretch about 30 seconds: hamstrings, quads, calves and shoulders.',
            minutes: 6,
            icon: 'yoga',
            motion: 'wobble',
        },
        {
            name: 'Deep breathing',
            description: 'Sit or lie down and take slow breaths until your pulse settles.',
            minutes: 2,
            icon: 'lungs',
            motion: 'pulse',
        },
    ],
};
