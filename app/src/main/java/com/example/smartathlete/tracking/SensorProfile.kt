package com.example.smartathlete.tracking

/**
 * Which watch sensors suit the drill currently running on the phone.
 *
 * Each drill type on the phone maps to one of these (constants/sensorProfiles.ts in the
 * mobile app) and the phone sends it in the WORKOUT command; keep the keys in sync.
 */
enum class SensorProfile(
    val key: String,
    val label: String,
    /** Count steps with the hardware step counter (forward running / walking). */
    val countSteps: Boolean = false,
    /** Count steps from accelerometer peaks: side shuffles the step counter misses. */
    val accelSteps: Boolean = false,
    /** Detect jumps from accelerometer free-fall followed by a landing impact. */
    val detectJumps: Boolean = false,
    /** Count repetitions from the wrist's repeating tilt (push-ups, sit-ups, squats). */
    val countReps: Boolean = false,
    /**
     * Plyometric rebounds: jumps as [detectJumps] (with stricter landing checks), plus the
     * ground-contact time between them. Only unbroken runs of quick rebounds count, and each
     * run only once the heart rate responds to it (see WorkoutSensorTracker).
     */
    val plyometric: Boolean = false,
) {
    // Warm-up and Running drills: jogging, sprints, shuttle runs
    RUN("run", "Running", countSteps = true),
    // Agility drills: side shuffles, carioca
    LATERAL("lateral", "Lateral", accelSteps = true),
    // Strength drills. Steps are off: the arm motion of a rep would only add false steps
    REPS("reps", "Reps", countReps = true),
    // Jumping drills. Steps are off: take-offs and landings would be counted as steps
    JUMP("jump", "Jumping", detectJumps = true),
    // Plyometrics drills (pogo hops, hurdle hops, split-squat jumps…). Steps off as for JUMP
    PLYO("plyo", "Plyometric", detectJumps = true, plyometric = true),
    // Cool-down drills: easy walk, stretching, breathing
    RECOVERY("recovery", "Recovery", countSteps = true),
    STATIONARY("stationary", "Stationary"),
    // Fallback when the drill type isn't known
    GAME("game", "Mixed", countSteps = true, detectJumps = true);

    val tracksSteps: Boolean get() = countSteps || accelSteps

    companion object {
        fun fromKey(key: String?): SensorProfile? =
            entries.firstOrNull { it.key.equals(key?.trim(), ignoreCase = true) }

        /** Fallback when only the drill type is known. */
        fun forCategory(category: String?): SensorProfile = when (category?.trim()?.lowercase()) {
            "warm-up", "running", "conditioning" -> RUN
            "strength" -> REPS
            "jumping" -> JUMP
            "plyometrics", "plyometric", "plyo" -> PLYO
            "agility", "tactics" -> LATERAL
            "cool-down" -> RECOVERY
            else -> GAME
        }
    }
}
