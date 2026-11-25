/**
 * Drill types, the drills the watch can track for each, and what the watch measures.
 * Copied from the mobile app (Mobile/constants/regimes.ts, workouts.ts, sensorProfiles.ts
 * and lib/drillTargets.ts): keep them in sync, since sessions made here run on the watch.
 */

export const DRILL_CATEGORIES = ["Warm-up","Running","Strength","Jumping","Plyometrics","Agility","Cool-down"]

/** Look of each drill type (same colors as the mobile app). */
export const CATEGORY_CONFIG = {
  "Warm-up": { icon: "bi-fire", color: "#E65100", bg: "#FFE0B2" },
  Running: { icon: "bi-person-walking", color: "#2E7D32", bg: "#C8E6C9" },
  Strength: { icon: "bi-trophy", color: "#C2410C", bg: "#FFEDD5" },
  Jumping: { icon: "bi-arrow-up-circle", color: "#6A1B9A", bg: "#E1BEE7" },
  Plyometrics: { icon: "bi-lightning-charge-fill", color: "#BE185D", bg: "#FCE7F3" },
  Agility: { icon: "bi-arrow-left-right", color: "#1565C0", bg: "#BBDEFB" },
  "Cool-down": { icon: "bi-wind", color: "#00838F", bg: "#B2EBF2" },
}

/** Readings the watch records for each drill type. */
export const TRACKS = {
  "Warm-up": "Tracked Steps · Heart Rate",
  Running: "Distance Covered · Speed / Pace · Heart Rate",
  Strength: "Repetitions · Heart Rate · Player Load",
  Jumping: "Vertical Jumps · Heart Rate · Player Load",
  Plyometrics: "Vertical Jumps · Heart Rate · Player Load",
  Agility: "Tracked Steps · Distance Covered · Player Load",
  "Cool-down": "HR Recovery · Heart Rate"
}

/** Watch sensors each drill type switches on. */
export const SENSORS = {
  "Warm-up": "Step counter · cadence & speed · heart rate",
  Running: "Step counter · cadence & speed · heart rate",
  Strength: "Accelerometer rep counter · heart rate · load (steps off)",
  Jumping: "Accelerometer jump detection · heart rate · load",
  Plyometrics: "Accelerometer jumps & ground-contact time · gyroscope · barometer (box / depth) · heart rate · load",
  Agility: "Accelerometer slide steps · heart rate · load",
  "Cool-down": "Heart-rate recovery · step counter"
}

/** Drills a coach can pick for each drill type (minutes is a guide only). */
export const WORKOUT_SUGGESTIONS = {
  "Warm-up": [
    {
      name: "Brisk walk",
      description: "Walk at a quick pace, swinging your arms naturally.",
      minutes: 3
    },
    {
      name: "Light jog",
      description: "Easy jog at a pace where you can still talk.",
      minutes: 5
    },
    {
      name: "High knees",
      description: "Run on the spot or forward, lifting each knee to hip height.",
      minutes: 2
    },
    {
      name: "Butt kicks",
      description: "Jog while kicking your heels up toward your glutes.",
      minutes: 2
    }
  ],
  Running: [
    {
      name: "Steady run",
      description: "Run at an even, moderate pace without stopping.",
      minutes: 10
    },
    {
      name: "Tempo run",
      description: "Run at a hard but controlled pace you can hold for the whole time.",
      minutes: 8
    },
    {
      name: "Sprint intervals",
      description: "Sprint for about 20 seconds, walk for 40 seconds, and repeat.",
      minutes: 8
    },
    {
      name: "Shuttle runs",
      description: "Sprint to a marker about 20 m away, touch the line and sprint back.",
      minutes: 6
    },
    {
      name: "Stair or hill runs",
      description: "Run up a hill or a flight of stairs, then walk back down to recover.",
      minutes: 6
    }
  ],
  Strength: [
    {
      name: "Push-ups",
      description: "Lower your chest to the floor and press back up with a straight body.",
      minutes: 3
    },
    {
      name: "Sit-ups",
      description: "Arms crossed on your chest, sit all the way up and lower back down.",
      minutes: 3
    },
    {
      name: "Squats",
      description: "Arms out in front, sit back until thighs are level, then stand up.",
      minutes: 3
    },
    {
      name: "Lunges",
      description: "Step forward and lower the back knee, alternating legs each rep.",
      minutes: 3
    },
    {
      name: "Jumping jacks",
      description: "Jump feet apart while raising your arms overhead, then back together.",
      minutes: 2
    },
    {
      name: "Burpees",
      description: "Drop to a push-up position, jump your feet back in and stand up tall.",
      minutes: 3
    }
  ],
  Jumping: [
    {
      name: "Vertical jumps",
      description: "Jump straight up as high as you can, land softly and reset.",
      minutes: 3
    },
    {
      name: "Squat jumps",
      description: "Drop into a squat, then explode upward into a jump.",
      minutes: 3
    },
    {
      name: "Tuck jumps",
      description: "Jump up and pull both knees toward your chest.",
      minutes: 2
    },
    {
      name: "Broad jumps",
      description: "Jump forward as far as you can from two feet, then walk back.",
      minutes: 3
    },
    {
      name: "Skater jumps",
      description: "Leap sideways from one foot to the other like a speed skater.",
      minutes: 3
    }
  ],
  Plyometrics: [
    {
      group: "Jumps in place",
      name: "Pogo hops",
      description: "Bounce on the balls of your feet with stiff ankles, off the ground again as fast as you can.",
      minutes: 2
    },
    {
      group: "Jumps in place",
      name: "Repeated tuck jumps",
      description: "Jump and pull both knees to your chest, then rebound straight into the next one.",
      minutes: 2
    },
    {
      group: "Jumps in place",
      name: "Split-squat jumps",
      description: "From a lunge, jump and switch legs in the air, land in a lunge and jump again straight away.",
      minutes: 3
    },
    {
      group: "Standing jumps",
      name: "Countermovement jumps",
      description: "Dip quickly and jump straight up as high as you can. Land, reset and repeat.",
      minutes: 3
    },
    {
      group: "Standing jumps",
      name: "Standing broad jumps",
      description: "From both feet, swing your arms and jump forward as far as you can. Stick the landing, then reset.",
      minutes: 3
    },
    {
      group: "Standing jumps",
      name: "Standing lateral jumps",
      description: "Jump sideways as far as you can from both feet, stick the landing, then jump back.",
      minutes: 3
    },
    {
      group: "Standing jumps",
      name: "Single-leg vertical jumps",
      description: "On one leg, jump straight up as high as you can, land on the same leg and reset. Switch legs.",
      minutes: 3
    },
    {
      group: "Multiple hops & jumps",
      name: "Hurdle hops",
      description: "Two-footed hops over a row of low hurdles or cones, rebounding straight into the next one.",
      minutes: 3
    },
    {
      group: "Multiple hops & jumps",
      name: "Lateral line hops",
      description: "Feet together, hop side to side over a line, spending as little time on the ground as possible.",
      minutes: 2
    },
    {
      group: "Multiple hops & jumps",
      name: "Zig-zag hops",
      description: "Two-footed hops diagonally left and right down a line of cones, rebounding off each landing.",
      minutes: 3
    },
    {
      group: "Multiple hops & jumps",
      name: "Single-leg hops",
      description: "Hop forward on one leg, rebounding quickly off each landing, then switch legs.",
      minutes: 3
    },
    {
      group: "Multiple hops & jumps",
      name: "Continuous broad jumps",
      description: "Broad jump forward, then rebound straight into the next one with as little ground time as possible.",
      minutes: 3
    },
    {
      group: "Bounds",
      name: "Alternate-leg bounding",
      description: "Exaggerated running strides: drive off one leg, fly forward and land on the other, then go again.",
      minutes: 3
    },
    {
      group: "Bounds",
      name: "Skater bounds",
      description: "Bound sideways from one leg to the other, landing on the outside leg and pushing straight back.",
      minutes: 3
    },
    {
      group: "Box drills",
      name: "Box jumps",
      description: "Jump from both feet onto a box (30-75 cm), land softly standing tall, then step down and reset.",
      minutes: 4
    },
    {
      group: "Box drills",
      name: "Lateral box jumps",
      description: "Stand beside the box and jump sideways onto it, land softly, step down and repeat on the other side.",
      minutes: 4
    },
    {
      group: "Box drills",
      name: "Single-leg box jumps",
      description: "Jump from one leg onto a low box, land on the same leg, step down and reset. Switch legs.",
      minutes: 4
    },
    {
      group: "Depth jumps",
      name: "Depth jumps",
      description: "Step (don't jump) off a box, and the moment your feet land, jump straight up as high as you can.",
      minutes: 4
    },
    {
      group: "Depth jumps",
      name: "Depth jump to broad jump",
      description: "Step off a box and, as soon as you land, jump forward as far as you can. Climb back up and reset.",
      minutes: 4
    }
  ],
  Agility: [
    {
      name: "Side shuffles",
      description: "Shuffle sideways in a low stance without crossing your feet.",
      minutes: 3
    },
    {
      name: "Carioca",
      description: "Move sideways, crossing one foot in front and then behind the other.",
      minutes: 3
    },
    {
      name: "Zig-zag shuffle",
      description: "Shuffle diagonally between markers, changing direction at each one.",
      minutes: 4
    },
    {
      name: "Line shuffle touches",
      description: "Shuffle between two lines about 5 m apart, touching each line.",
      minutes: 4
    }
  ],
  "Cool-down": [
    {
      name: "Easy walk",
      description: "Walk slowly to bring your heart rate down gradually.",
      minutes: 3
    },
    {
      name: "Static stretching",
      description: "Hold each stretch about 30 seconds: hamstrings, quads, calves and shoulders.",
      minutes: 6
    },
    {
      name: "Deep breathing",
      description: "Sit or lie down and take slow breaths until your pulse settles.",
      minutes: 2
    }
  ]
}

/** Drill types whose reps / jumps the watch counts, so a sets × reps target makes sense. */
export const drillHasSetsReps = (c) => c === "Strength" || c === "Jumping" || c === "Plyometrics"
export const drillCountUnit = (c) => (c === "Jumping" || c === "Plyometrics" ? "jumps" : "reps")
export function drillTargetTotal(d) {
  const sets = Number(d?.sets), reps = Number(d?.reps)
  if (!Number.isFinite(sets) || !Number.isFinite(reps) || sets <= 0 || reps <= 0) return null
  return Math.round(sets) * Math.round(reps)
}
