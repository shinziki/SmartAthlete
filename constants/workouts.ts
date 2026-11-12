import { DrillCategory } from './regimes';

export interface WorkoutSuggestion {
    name: string;
    description: string;
    /** Rough time a coach might give it (a guide only; the coach sets the real duration) */
    minutes: number;
}

export const WORKOUT_SUGGESTIONS: Record<DrillCategory, WorkoutSuggestion[]> = {
    'Warm-up': [
        {
            name: 'Light jog & arm circles',
            description: 'Easy laps with arm circles and shoulder rolls to raise body temperature.',
            minutes: 3,
        },
        {
            name: 'Dynamic stretch lines',
            description:
                'Half-court lengths of lunges, leg swings, high knees, butt kicks and carioca, jogging back between each.',
            minutes: 6,
        },
        {
            name: 'Stationary ball handling',
            description: 'Figure-8, around-the-world and behind-the-back dribbles, about 30 seconds each.',
            minutes: 4,
        },
        {
            name: '5-man pass and move',
            description: 'Five players pass and cut without dribbling to build rhythm and spacing.',
            minutes: 5,
        },
        {
            name: 'Three-line layups',
            description: 'Catch in stride, pass on the move and finish at the rim at half speed.',
            minutes: 5,
        },
        {
            name: 'Low-impact plyometrics',
            description: 'Skips and pogo hops with soft, controlled landings to prepare knees and ankles.',
            minutes: 3,
        },
        {
            name: 'Easy defensive slides',
            description: 'Slide lane to lane in a low stance at a relaxed pace.',
            minutes: 3,
        },
    ],

    Tactics: [
        {
            name: '4-on-4 shell drill',
            description: 'Practice on-ball, deny and help-side positions as the ball moves around the perimeter.',
            minutes: 10,
        },
        {
            name: 'Closeout drill',
            description: 'Sprint to the shooter, chop your feet, hand up, and contain the first drive.',
            minutes: 8,
        },
        {
            name: 'Consecutive stops',
            description: 'Defense must string together several stops in a row before it earns a turn on offense.',
            minutes: 10,
        },
        {
            name: 'Dominoes transition',
            description: 'Build from 1-on-2 to 2-on-3, 3-on-4 and 4-on-5, finishing as a full 5-on-5.',
            minutes: 12,
        },
        {
            name: '4-on-4-on-4 full-court transition',
            description: 'Three teams rotate between offense, defense and waiting while pushing the ball up the floor.',
            minutes: 12,
        },
        {
            name: 'Drive-and-kick spacing',
            description: 'Drive to draw help, then pass out to open teammates who keep proper spacing.',
            minutes: 8,
        },
        {
            name: 'Pick-and-roll coverage',
            description: 'Defend the ball screen together: communicate, switch or drop, and recover.',
            minutes: 10,
        },
    ],

    Conditioning: [
        {
            name: 'Line sprints (suicides)',
            description:
                'Baseline to the near free-throw line and back, half court and back, far free-throw line and back, then full court. Rest about a minute between sets.',
            minutes: 10,
        },
        {
            name: 'Defensive slide suicides',
            description: 'Same court lines as suicides, but slide in a defensive stance instead of running.',
            minutes: 8,
        },
        {
            name: '17s',
            description: 'Sideline-to-sideline sprints: aim for 17 touches in one minute.',
            minutes: 8,
        },
        {
            name: 'Full-court sprints',
            description: 'Baseline-to-baseline sprints with a walk back for recovery.',
            minutes: 5,
        },
        {
            name: 'Defensive reaction drill',
            description: 'React to the coach with slides, sprints and jumps to work quickness and stamina together.',
            minutes: 5,
        },
        {
            name: 'Lane slides & Z-drill',
            description: 'Slide, backpedal and sprint around the lane or cones to build footwork and fitness.',
            minutes: 8,
        },
        {
            name: 'Free throws under fatigue',
            description: 'Pull a player out mid-run to shoot free throws so they practice making shots when tired.',
            minutes: 5,
        },
    ],

    Scrimmage: [
        {
            name: '3-on-3 half-court games',
            description: 'Small games that force more touches, spacing and quick decisions.',
            minutes: 10,
        },
        {
            name: '4-on-4 transition scrimmage',
            description: 'Controlled play with an emphasis on pushing the ball and getting back on defense.',
            minutes: 10,
        },
        {
            name: '5-on-5 controlled scrimmage',
            description: 'Full team play where the coach stops play to correct spacing, rotations or shot selection.',
            minutes: 15,
        },
        {
            name: 'Full-court 5-on-5 scrimmage',
            description: 'Competitive game-speed play to apply everything from practice.',
            minutes: 20,
        },
        {
            name: 'Rule-limited scrimmage',
            description: 'Play with a restriction, such as no dribbling, a two-dribble limit or pass-and-move only.',
            minutes: 15,
        },
        {
            name: 'Shot-clock situations',
            description: 'Scrimmage with a short shot clock to practice late-possession decisions.',
            minutes: 10,
        },
    ],

    'Cool-down': [
        {
            name: 'Easy jog or walk',
            description: 'A slow lap or two to bring heart rate down gradually.',
            minutes: 3,
        },
        {
            name: 'Static stretching',
            description:
                'Hold each stretch about 30 seconds: hamstrings, quads, calves, hip flexors, groin, shoulders and triceps.',
            minutes: 8,
        },
        {
            name: 'Foam rolling',
            description: 'Roll quads, hamstrings and calves, slowing down on any tight spots.',
            minutes: 5,
        },
        {
            name: 'Breathing reset',
            description: 'Slow breaths in a seated or lying position to settle the body.',
            minutes: 2,
        },
        {
            name: 'Hydrate & team debrief',
            description: 'Rehydrate and review what went well and what to improve next session.',
            minutes: 3,
        },
    ],
};