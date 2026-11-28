package com.example.smartathlete.tracking

import kotlin.math.max

/**
 * Finds real jumps in the wrist accelerometer, and ignores the watch just being swung,
 * flicked or shaken by hand — including the arm being swung up and down while the watch
 * is worn, to fake jumps for the coach.
 *
 * A real jump has three parts, and all three must be there, in this order:
 *
 *   1. Push-off   the legs push the whole body up: the watch feels well over 1 g, and keeps
 *                 feeling it for a while ([MIN_PUSH_MS]: legs extend over ~200-300 ms; an
 *                 arm flick is a short spike). The speed gained must fit the flight that
 *                 follows (a higher jump needs a bigger push).
 *   2. Flight     the whole body is falling freely: the watch feels light (under ~0.6 g;
 *                 not 0, the arms still move a little in the air) steadily for at least
 *                 [MIN_FLIGHT_MS], not just a short dip. A hand swing gets a brief, ragged dip.
 *   3. Landing    the feet hit the ground: a hard shock travels up the body (> ~1.7 g at
 *                 the wrist, [LANDING_PEAK]) and the legs then absorb it, so the watch stays
 *                 over 1 g for a moment ([MIN_ABSORB_MS]). An arm braked in mid-air slows
 *                 down smoothly, with no shock and no absorption.
 *
 * During the flight the wrist must also not rotate much: swinging the forearm up and down
 * turns the watch through a large angle while it "falls", a body in the air doesn't
 * ([MAX_FLIGHT_TURN] in total, [MAX_FLIGHT_SPIN] on average). Drills that drive the arms
 * through the flight (bounds, broad / lateral / skater jumps: [armSwing]) get wider limits.
 *
 * A movement with the jump's shape that fails one of these is reported as [swingRejected]
 * (the coach sees how many were not counted). What still gets past (e.g. a skilled arm
 * toss) is caught by the heart-rate check in [WorkoutSensorTracker]: jumps that don't raise
 * the heart rate are not counted.
 *
 * Plyometric mode ([plyometric], Plyometrics drills) is stricter still. Plyometric drills are
 * runs of quick rebounds, so on top of the checks above:
 *
 *   - Ground contact is measured: the time from a counted jump's landing impact to the next
 *     take-off ([contactMs]). The tracker only counts unbroken runs of rebounds.
 *     A "contact" shorter than [PLYO_MIN_CONTACT_MS] isn't a foot on the ground.
 *   - The landing must be a foot strike: the shock reaches [LANDING_PEAK] within
 *     [PLYO_MAX_LANDING_RISE_MS] of the end of the flight. Feet hitting the ground send a
 *     sharp shock up the body; an arm stopped by its own muscles builds up to it slowly.
 *   - The push must fit the flight more closely ([PLYO_MIN_PUSH_RATIO]..[PLYO_MAX_PUSH_RATIO]).
 *   - In a rebound the ground contact itself is the push, so it may be shorter than
 *     [MIN_PUSH_MS] (stiff pogo contacts are ~100-200 ms), but never under
 *     [PLYO_REBOUND_MIN_PUSH_MS]. The first jump of a run needs the full [MIN_PUSH_MS].
 *
 * Box and depth drills (only when the watch has a barometer, which then has to confirm them;
 * see WorkoutSensorTracker):
 *   - [allowSoftLanding]  landing on a box near the top of the jump is softer than landing on
 *                         the ground: a landing peak down to [BOX_LANDING_PEAK] is allowed, and
 *                         reported as [JumpInfo.softLanding]. The tracker counts it only if the
 *                         barometer shows the athlete ended up higher.
 *   - [allowDrops]        a depth jump starts by stepping off a box: a real flight and a hard,
 *                         sharp landing, but no push. That "drop" isn't a jump (nor a faked one);
 *                         the jump straight out of its landing is reported with
 *                         [JumpInfo.afterDrop], and the tracker counts it only if the barometer
 *                         shows the athlete came down from a box.
 */
class JumpDetector {
    companion object {
        private const val G = 9.80665f
        // Tuned for a wrist: during a real jump the arms still move, so the watch doesn't
        // feel fully weightless. Too strict = real jumps missed; too loose = swings counted.
        /** "Light" (in the air): below ~0.6 g (the arms still move, so a wrist rarely reads 0) */
        private const val FREEFALL = 5.9f
        /** A short wobble inside a flight is allowed up to this (~0.9 g) */
        private const val FREEFALL_SOFT = 8.8f
        /** ~4 cm jump: shorter "flights" are what an arm can fake; real jump drills fly 250 ms+ */
        const val MIN_FLIGHT_MS = 180L
        private const val MAX_FLIGHT_MS = 900L
        /** Share of the flight that must be light */
        private const val MIN_WEIGHTLESS_SHARE = 0.65f
        /** Landing impact starts over ~1.4 g ... */
        private const val LANDING = 13.7f
        /** ... within this long after the flight ends */
        private const val LANDING_WINDOW_MS = 250L
        /** The shock of the feet hitting the ground: peak over ~1.9 g at the wrist */
        private const val LANDING_PEAK = 18.6f
        /** After the impact the legs absorb it: over ~1.1 g for at least this long */
        private const val ABSORB = 10.8f
        private const val MIN_ABSORB_MS = 40L
        /** How long after the impact the landing is looked at before judging */
        private const val LANDING_EVAL_MS = 200L
        /** Push-off searched in this window before take-off */
        private const val PUSH_WINDOW_MS = 700L
        /** Push-off: over ~1.1 g ... */
        private const val PUSH_LEVEL = 10.8f
        /** ... for at least this long (legs extending), ending shortly before take-off */
        private const val MIN_PUSH_MS = 130L
        private const val PUSH_END_GAP_MS = 300L
        /** Push speed vs the speed the flight needs (g·t/2). Wrist arm swing adds some on top. */
        private const val MIN_PUSH_RATIO = 0.25f
        private const val MAX_PUSH_RATIO = 6.0f
        /** Mean wrist spin during flight above this (rad/s) = the arm was whipped */
        private const val MAX_FLIGHT_SPIN = 6.0f
        /** Total wrist turn during flight above this (rad, ~75°) = the forearm was swung */
        private const val MAX_FLIGHT_TURN = 1.3f
        // Arm-swing drills ([armSwing]): bounds and broad / lateral / skater jumps drive the
        // arms hard through the flight (across the body, or from behind to in front), so a
        // real one turns the wrist ~90-150°. The limits above would reject every one of them.
        // A forearm whipped faster than this still fails, and the push, flight, foot strike,
        // run and heart-rate checks all still apply.
        // A clear flight ([clearFlight]: truly weightless, < ~0.6 g, for at least MIN_FLIGHT_MS
        // in all, the evidence a jump in place must show) is real. Then softer evidence
        // elsewhere doesn't reject it: recorded real jumps (2026-11-24) with clear flights
        // landed at 1.4-1.8 g (coached "land softly"), pushed at 6-10× what the flight needs
        // (arms swung up), or flew in a window stretched by the arms
        /** Landing peak a clear flight needs (~1.4 g, = [LANDING]); others need [LANDING_PEAK] */
        private const val CLEAR_FLIGHT_LANDING_PEAK = 13.7f
        /** Push vs flight ratio a clear flight may reach (others: MAX / PLYO_MAX_PUSH_RATIO) */
        private const val CLEAR_FLIGHT_MAX_PUSH_RATIO = 12f
        private const val ARM_SWING_MAX_FLIGHT_SPIN = 9.0f
        private const val ARM_SWING_MAX_FLIGHT_TURN = 2.6f
        // Recorded skater bounds (Galaxy Watch 5, 2026-11-24) showed the arms keep moving all
        // through the flight: the wrist reads 0.6-0.9 g in the air, never the < 0.6 g of a jump
        // in place, and the landing is buried in the arm swing across the body. So in these
        // drills "in the air" is below ~0.9 g (wobbles to ~1.25 g), and the push carries the
        // sideways speed too (push vs flight ratios of 5.7-9.9 were real bounds).
        private const val ARM_SWING_LIGHT = 8.8f
        private const val ARM_SWING_LIGHT_SOFT = 12.3f
        private const val ARM_SWING_MIN_FLIGHT_MS = 100L
        private const val ARM_SWING_MAX_PUSH_RATIO = 20f
        /**
         * ...so the push must come from the legs: the wrist is carried along by the body and
         * barely rotates (real bounds: ~1-5 rad/s on average). A push made by swinging the arm
         * spins the wrist faster.
         */
        private const val ARM_SWING_MAX_PUSH_SPIN = 5.0f
        /** Tuck jumps ([tuck]): light time the broken-up flight must hold, and its least share */
        private const val TUCK_MIN_LIGHT_MS = 60L
        private const val TUCK_MIN_LIGHT_SHARE = 0.2f
        // Jumps in place ([inPlace]: squat, tuck, vertical / countermovement jumps). Pilot
        // 2026-11-26 (all-women group, shorter athletes): real squat and tuck jumps were turned
        // down. A lower jump lands softer and pushes off over a shorter leg extension, so
        // these drills accept:
        /** ...a landing from ~1.4 g (others need [LANDING_PEAK] unless the flight was clear) */
        private const val IN_PLACE_LANDING_PEAK = 13.7f
        /** ...a push-off from this long (shorter legs extend faster) */
        private const val IN_PLACE_MIN_PUSH_MS = 100L
        /**
         * Tuck jumps: hands meeting the knees in the air jolt the wrist to ~1.4-1.8 g. That's
         * still the flight; only a harder reading (a foot strike: 2.2-10 g recorded) lands it.
         */
        private const val TUCK_IN_AIR_MAX = 17.6f
        /** ...over the last this-long of the push (the drive into take-off) */
        private const val PUSH_SPIN_WINDOW_MS = 150L
        private const val REFRACTORY_MS = 350L

        // Plyometric mode (see the class comment)
        /** Shortest real ground contact between two rebounds */
        const val PLYO_MIN_CONTACT_MS = 60L
        /** Flight end (last light sample) to the landing shock peak: a foot strike is sharp */
        private const val PLYO_MAX_LANDING_RISE_MS = 120L
        /**
         * Arm-swing drills: the arms brake before a travelling (often single-leg) landing, so
         * the wrist stops feeling light a little before the foot strikes.
         */
        private const val ARM_SWING_MAX_LANDING_RISE_MS = 350L
        private const val PLYO_MIN_PUSH_RATIO = 0.35f
        private const val PLYO_MAX_PUSH_RATIO = 5.0f
        /** Push needed for a take-off straight out of a rebound contact */
        private const val PLYO_REBOUND_MIN_PUSH_MS = 60L
        /** Contact longer than this isn't a rebound (the push is then checked as a fresh jump) */
        const val PLYO_REBOUND_MAX_CONTACT_MS = 800L
        /** Landing on a box (near the top of the jump) peaks over ~1.5 g at the wrist */
        private const val BOX_LANDING_PEAK = 14.7f
        /**
         * Samples further apart than this (100 Hz = 10 ms; ~4 lost) mean readings went
         * missing: a flight or landing with a hole in it can't be judged, and neither can a
         * push-off measured across one. Such a candidate is dropped, not counted as a fake.
         */
        const val MAX_SAMPLE_GAP_MS = 40L
        private const val BUFFER = 128 // > PUSH_WINDOW_MS at 100 Hz
    }

    // Recent |a| (m/s²), wrist spin (rad/s) and their times (ms), for the push-off before take-off
    private val magBuf = FloatArray(BUFFER)
    private val spinBuf = FloatArray(BUFFER)
    private val timeBuf = LongArray(BUFFER)
    private var bufHead = 0
    private var bufCount = 0

    private enum class Phase { GROUND, FLIGHT, LANDING }
    private var phase = Phase.GROUND
    private var flightStart = 0L
    private var lastWeightless = 0L
    private var flightSamples = 0
    private var weightlessSamples = 0
    /** Flight samples truly light (< [FREEFALL]), whatever [light] the drill uses, and their time (ms) */
    private var strictSamples = 0
    private var strictMs = 0f
    private var spinSum = 0f
    /** Total wrist turn during the flight (rad), from gyroscope speed × time */
    private var turn = 0f
    private var lastSampleAt = 0L
    private var pushSpeed = 0f
    private var pushMs = 0L
    /** Mean wrist spin (rad/s) over the push measured in [pushMs] */
    private var pushSpin = 0f
    private var lastJumpAt = 0L
    // Landing being looked at
    private var flightMs = 0L
    private var impactAt = 0L
    private var landingPeak = 0f
    private var absorbFrom = 0L
    private var absorbMs = 0L
    /** When the flight ended (last light sample) and when the landing shock reached [LANDING_PEAK] */
    private var flightEndAt = 0L
    private var shockAt = 0L

    /** When the landing shock reached [BOX_LANDING_PEAK] (box landings) */
    private var softShockAt = 0L
    /** The landing being judged peaked under [LANDING_PEAK] (allowed with [allowSoftLanding]) */
    private var soft = false

    // Ground contact (plyometric rebounds): the last landing, and whether it was a counted jump
    // or a depth-jump drop
    private var lastLandingAt = 0L
    private var lastLandingWasJump = false
    private var lastLandingWasDrop = false
    /** Take-off of the last drop (stepping off the box) */
    private var dropTakeoffAt = 0L
    /** Contact before the take-off of the flight being watched; -1 = not straight after a jump */
    private var flightContactMs = -1L
    /** The flight being watched took off straight out of a drop's landing */
    private var flightAfterDrop = false
    private var flightDropTakeoffAt = 0L
    /** Last time readings went missing ([MAX_SAMPLE_GAP_MS]); 0 = none */
    private var lastGapAt = 0L
    /** The flight being watched took off with missing readings in its push-off window */
    private var flightAfterGap = false

    /** Stricter checks for plyometric rebounds (see the class comment). */
    var plyometric = false
    /** Box drills: soft landings on a box allowed (the tracker confirms them by barometer). */
    var allowSoftLanding = false
    /** Depth drills: a drop off a box (no push) may precede a jump (confirmed by barometer). */
    var allowDrops = false
    /**
     * Arm-swing drills (bounds, broad / lateral / skater / squat jumps): the wrist may turn and spin
     * more during the flight, and the landing shock may come a little later after it.
     */
    var armSwing = false
    /**
     * Tuck jumps (with [armSwing]): the knees are pulled up and the hands brought to them in
     * the air, so the wrist is pushed around all through the flight and never reads steadily
     * light (recorded 2026-11-26: 24-63% of the flight window under ~0.9 g, < 0.6 g for 0-100 ms
     * at a time). The flight must still hold [TUCK_MIN_LIGHT_MS] of light readings, at least
     * [TUCK_MIN_LIGHT_SHARE] of it; push, foot strike, absorption, run and heart rate are
     * checked as usual. The tracker judges the jump's height on the whole take-off-to-landing
     * time ([JumpInfo.airMs]) instead of the light part.
     */
    var tuck = false
    /**
     * Jumps in place (squat, tuck, vertical / countermovement jumps): lower, softer jumps by
     * shorter or lighter athletes still count (see [IN_PLACE_LANDING_PEAK]). Not for bounds
     * and skater jumps, whose arm-swing fakes the stricter landing check catches.
     */
    var inPlace = false

    // "In the air" levels and shortest flight for the current drill
    private val light: Float get() = if (armSwing) ARM_SWING_LIGHT else FREEFALL
    private val lightSoft: Float get() = if (tuck) TUCK_IN_AIR_MAX else if (armSwing) ARM_SWING_LIGHT_SOFT else FREEFALL_SOFT
    /** Reading that ends the flight as a landing impact (tuck jumps: only a foot strike does) */
    private val landingStart: Float get() = if (tuck) TUCK_IN_AIR_MAX else LANDING
    private val minFlightMs: Long get() = if (armSwing) ARM_SWING_MIN_FLIGHT_MS else MIN_FLIGHT_MS

    /**
     * A counted jump. Times are the accelerometer's event times (ms).
     *   [contactMs]   ground contact before the take-off, from the previous counted jump's
     *                 (or drop's) landing; -1 when that landing wasn't one
     *   [beforeAt]    when the athlete last stood still before it: the drop's take-off for a
     *                 depth jump, otherwise this jump's take-off (for the barometer)
     */
    data class JumpInfo(
        val takeoffAt: Long,
        val impactAt: Long,
        val flightMs: Long,
        val contactMs: Long,
        val softLanding: Boolean,
        val afterDrop: Boolean,
        val beforeAt: Long,
    ) {
        /** Take-off to landing impact: the whole time in the air, light readings or not. */
        val airMs: Long get() = impactAt - takeoffAt
    }

    /** The jump just reported by [onSample] (null after a false return). */
    var lastJump: JumpInfo? = null; private set
    /** Ground contact (ms) before the jump just reported, -1 if it wasn't a rebound. */
    val contactMs: Long get() = lastJump?.contactMs ?: -1L

    /** Why the last candidate was turned down (for logs / tuning). */
    var lastRejectReason: String? = null; private set
    /**
     * The last candidate had a jump's shape (push, flight, landing) but failed a check an arm
     * swing fails: counted as "jump-like movement not counted" for the coach.
     */
    var swingRejected = false; private set
    /** Each judged candidate, for Logcat ("adb logcat -s JumpDetector") while tuning. */
    var log: ((String) -> Unit)? = null

    fun reset() {
        bufHead = 0; bufCount = 0
        phase = Phase.GROUND
        lastJumpAt = 0L
        lastSampleAt = 0L
        lastGapAt = 0L
        flightAfterGap = false
        lastLandingAt = 0L
        lastLandingWasJump = false
        lastLandingWasDrop = false
        flightContactMs = -1L
        flightAfterDrop = false
        lastJump = null
    }

    /** Take-off: note the ground contact since the last counted jump's (or drop's) landing. */
    private fun takeOff(now: Long, spin: Float) {
        val fromLanding = (lastLandingWasJump || lastLandingWasDrop) && lastLandingAt > 0L
        flightContactMs = if (fromLanding) now - lastLandingAt else -1L
        flightAfterDrop = lastLandingWasDrop && flightContactMs in 0L..PLYO_REBOUND_MAX_CONTACT_MS
        flightDropTakeoffAt = if (flightAfterDrop) dropTakeoffAt else 0L
        flightAfterGap = lastGapAt > 0L && now - lastGapAt <= PUSH_WINDOW_MS
        measurePush(now)
        phase = Phase.FLIGHT
        flightStart = now
        lastWeightless = now
        flightSamples = 1
        weightlessSamples = 1
        strictSamples = 0
        strictMs = 0f
        spinSum = spin
        turn = 0f
    }

    /** A flight that wasn't a jump: a run of rebounds is broken. */
    private fun noJump() {
        lastLandingWasJump = false
        lastLandingWasDrop = false
        phase = Phase.GROUND
    }

    /**
     * One accelerometer sample: [magnitude] in m/s², [now] in ms, [spin] = current wrist
     * rotation speed (rad/s, 0 when the watch has no gyroscope). True = a real jump just landed.
     * After a false return, [swingRejected] says whether a jump-shaped movement was turned down.
     */
    fun onSample(magnitude: Float, now: Long, spin: Float): Boolean {
        swingRejected = false
        lastJump = null
        var jumped = false
        // Readings went missing: a flight or landing in progress can't be judged
        val gap = if (lastSampleAt == 0L) 0L else now - lastSampleAt
        if (gap > MAX_SAMPLE_GAP_MS) {
            lastGapAt = now
            if (phase != Phase.GROUND) {
                lastRejectReason = "sensor gap ${gap}ms"
                log?.invoke("sensor gap ${gap}ms during ${phase.name.lowercase()} -> no (dropped, not a fake)")
                noJump()
            }
        }
        val dt =if (lastSampleAt == 0L) 0f else ((now - lastSampleAt).coerceIn(0L, 50L)) / 1000f
        lastSampleAt = now
        when (phase) {
            Phase.GROUND -> {
                // Plyometric rebounds leave the ground again 60-800 ms after landing, so no
                // refractory there: a take-off still needs the full push/flight/landing to count
                val refractory = if (plyometric) 0L else REFRACTORY_MS
                if (magnitude < light && now - lastJumpAt > refractory) {
                    // Take-off: how much speed did the push give, and for how long?
                    takeOff(now, spin)
                }
            }
            Phase.FLIGHT -> {
                val flight = lastWeightless - flightStart
                when {
                    magnitude < lightSoft && now - flightStart <= MAX_FLIGHT_MS -> {
                        flightSamples++
                        spinSum += spin
                        turn += spin * dt
                        if (magnitude < FREEFALL) {
                            strictSamples++
                            strictMs += dt * 1000f
                        }
                        if (magnitude < light) {
                            weightlessSamples++
                            lastWeightless = now
                        }
                    }
                    magnitude > landingStart && now - lastWeightless <= LANDING_WINDOW_MS -> {
                        flightMs = flight
                        if (!shapeOk(checkPush = !allowDrops)) {
                            // Not jump-shaped (e.g. the dip before a jump, then the push):
                            // back to the ground at once, ready for the real take-off
                            log?.invoke("flight=${flightMs}ms -> no: $lastRejectReason")
                            noJump()
                        } else {
                            // Impact: look at the landing a little longer before judging
                            phase = Phase.LANDING
                            impactAt = now
                            landingPeak = magnitude
                            absorbFrom = now
                            absorbMs = 0L
                            flightEndAt = lastWeightless
                            shockAt = if (magnitude >= LANDING_PEAK) now else 0L
                            softShockAt = if (magnitude >= BOX_LANDING_PEAK) now else 0L
                        }
                    }
                    now - lastWeightless > LANDING_WINDOW_MS || now - flightStart > MAX_FLIGHT_MS + LANDING_WINDOW_MS -> {
                        lastRejectReason = "no landing"
                        noJump()
                    }
                    // Between ~0.5 g and 1.6 g just after the flight: wait for the impact
                }
            }
            Phase.LANDING -> {
                if (magnitude < FREEFALL) {
                    // In the air again already (a hop straight after the last one, or that
                    // "landing" was really a push): decide on what was seen, then take off
                    jumped = judge()
                    if (jumped) lastJumpAt = now
                    takeOff(now, spin)
                    remember(magnitude, now, spin)
                    return jumped
                }
                if (magnitude > landingPeak) landingPeak = magnitude
                if (shockAt == 0L && magnitude >= LANDING_PEAK) shockAt = now
                if (softShockAt == 0L && magnitude >= BOX_LANDING_PEAK) softShockAt = now
                // Longest stretch over ~1.2 g since the impact (legs absorbing it)
                if (magnitude > ABSORB) {
                    if (absorbFrom == 0L) absorbFrom = now
                    absorbMs = max(absorbMs, now - absorbFrom)
                } else {
                    absorbFrom = 0L
                }
                if (now - impactAt >= LANDING_EVAL_MS) {
                    jumped = judge()
                    if (jumped) lastJumpAt = now
                    phase = Phase.GROUND
                }
            }
        }
        remember(magnitude, now, spin)
        return jumped
    }

    private enum class Verdict { JUMP, DROP, NO }

    private fun judge(): Boolean {
        val verdict = check()
        val ok = verdict == Verdict.JUMP
        // The run of rebounds goes on only from a counted jump's (or a drop's) landing
        lastLandingWasJump = ok
        lastLandingWasDrop = verdict == Verdict.DROP
        if (verdict == Verdict.DROP) dropTakeoffAt = flightStart
        lastLandingAt = impactAt
        if (ok) {
            lastJump = JumpInfo(
                takeoffAt = flightStart,
                impactAt = impactAt,
                flightMs = flightMs,
                contactMs = flightContactMs,
                softLanding = soft,
                afterDrop = flightAfterDrop,
                beforeAt = if (flightAfterDrop) flightDropTakeoffAt else flightStart,
            )
        }
        log?.invoke(
            (if (plyometric) "[plyo contact=${flightContactMs}ms rise=${landingRiseMs()}ms" +
                (if (soft) " soft" else "") + (if (flightAfterDrop) " after-drop" else "") + "] " else "") +
            "flight=${flightMs}ms light=${weightlessSamples}/${flightSamples} push=${"%.2f".format(pushSpeed)}m/s " +
                "${pushMs}ms${if (armSwing) " pushSpin=${"%.1f".format(pushSpin)} strict=$strictSamples" else ""} land=${"%.1f".format(landingPeak / G)}g absorb=${absorbMs}ms " +
                "spin=${"%.1f".format(spinSum / max(1, flightSamples))} turn=${"%.2f".format(turn)} -> " +
                when (verdict) {
                    Verdict.JUMP -> "JUMP"
                    Verdict.DROP -> "DROP (step off a box)"
                    Verdict.NO -> "no: $lastRejectReason${if (swingRejected) " (swing)" else ""}"
                }
        )
        return ok
    }

    private fun check(): Verdict {
        soft = false
        if (flightAfterGap) {
            // The push-off can't be measured across missing readings: dropped, not a fake
            lastRejectReason = "sensor gap before take-off"
            return Verdict.NO
        }
        if (!shapeOk(checkPush = !allowDrops)) return Verdict.NO
        val spin = spinSum / max(1, flightSamples)

        if (allowDrops) {
            val ratio = pushSpeed / (G * (flightMs / 1000f) / 2f)
            if (ratio < MIN_PUSH_RATIO) {
                // No push: stepping off a box (depth jump), if the landing is a real one.
                // Not a jump, and not reported as a faked one either
                val why = landingProblem(spin)
                lastRejectReason = why ?: "drop"
                return if (why == null) Verdict.DROP else Verdict.NO
            }
            if (ratio > MAX_PUSH_RATIO) {
                lastRejectReason = "push ${"%.2f".format(ratio)}"
                return Verdict.NO
            }
        }

        // Jump-shaped from here on: anything failing now looks like a faked jump
        // Plyometric rebound: the ground contact before this take-off was the push
        val rebound = plyometric && flightContactMs in 0L..PLYO_REBOUND_MAX_CONTACT_MS
        val minPushMs = if (rebound) PLYO_REBOUND_MIN_PUSH_MS else if (inPlace) IN_PLACE_MIN_PUSH_MS else MIN_PUSH_MS
        soft = plyometric && allowSoftLanding && landingPeak < LANDING_PEAK && landingPeak >= BOX_LANDING_PEAK
        val why = when {
            pushMs < minPushMs -> "push only ${pushMs}ms (arm flick, not legs)"
            // Arm-swing drills accept a looser flight; when the flight wasn't truly weightless
            // (as a jump in place must be), the push must be the legs'. Bounds toward the
            // watch side drive that arm hard at the push but then fly cleanly.
            armSwing && !strictFlight() && pushSpin > ARM_SWING_MAX_PUSH_SPIN ->
                "push spun the wrist ${"%.1f".format(pushSpin)} rad/s (arm, not legs)"
            else -> landingProblem(spin)
        }
        if (why != null) {
            lastRejectReason = why
            swingRejected = true
            return Verdict.NO
        }
        lastRejectReason = null
        return Verdict.JUMP
    }

    /**
     * The flight passes the jump-in-place standard: long enough and mostly under ~0.6 g, or
     * under ~0.6 g for at least [MIN_FLIGHT_MS] in all. (Arms swung up through a squat jump
     * stretch the loose flight window to ~400-600 ms, so a share of it undersells a real
     * 200-300 ms of true weightlessness.)
     */
    private fun strictFlight(): Boolean =
        (flightMs >= MIN_FLIGHT_MS && strictSamples.toFloat() / max(1, flightSamples) >= MIN_WEIGHTLESS_SHARE) ||
            strictMs >= MIN_FLIGHT_MS

    /** Truly weightless (< ~0.6 g) for at least [MIN_FLIGHT_MS] in all: a real flight. */
    private fun clearFlight(): Boolean = strictMs >= MIN_FLIGHT_MS

    /** Largest push vs flight ratio allowed: [normal] unless the drill or the flight says more. */
    private fun maxPushRatio(normal: Float): Float = when {
        armSwing -> ARM_SWING_MAX_PUSH_RATIO
        clearFlight() -> max(normal, CLEAR_FLIGHT_MAX_PUSH_RATIO)
        else -> normal
    }

    /** Wrist steady in the air and a real (foot) landing; null when it passes. */
    private fun landingProblem(spin: Float): String? = when {
        spin > (if (armSwing) ARM_SWING_MAX_FLIGHT_SPIN else MAX_FLIGHT_SPIN) -> "spin ${"%.1f".format(spin)}"
        turn > (if (armSwing) ARM_SWING_MAX_FLIGHT_TURN else MAX_FLIGHT_TURN) -> "wrist turned ${"%.2f".format(turn)} rad in the air (arm swung)"
        landingPeak < (if (clearFlight()) CLEAR_FLIGHT_LANDING_PEAK else if (inPlace) IN_PLACE_LANDING_PEAK else LANDING_PEAK) && !soft ->
            "soft stop ${"%.1f".format(landingPeak / G)}g (no foot impact)"
        absorbMs < MIN_ABSORB_MS -> "no landing absorption (${absorbMs}ms)"
        plyometric -> plyoProblem()
        else -> null
    }

    /** Flight end to the landing shock peak (ms); Long.MAX_VALUE if it never got there. */
    private fun landingRiseMs(): Long {
        // A soft landing after a clear flight never reaches LANDING_PEAK: its impact is the shock
        val at = if (soft) softShockAt else if (shockAt == 0L && (clearFlight() || inPlace)) impactAt else shockAt
        return if (at == 0L || flightEndAt == 0L) Long.MAX_VALUE else at - flightEndAt
    }

    /** The extra plyometric checks on a jump-shaped movement, or null when it passes. */
    private fun plyoProblem(): String? {
        val rise = landingRiseMs()
        val ratio = pushSpeed / (G * (flightMs / 1000f) / 2f)
        return when {
            flightContactMs in 0L until PLYO_MIN_CONTACT_MS ->
                "contact ${flightContactMs}ms (too short for a foot on the ground)"
            rise > (if (armSwing) ARM_SWING_MAX_LANDING_RISE_MS else PLYO_MAX_LANDING_RISE_MS) ->
                "landing shock built up over ${if (rise == Long.MAX_VALUE) "-" else rise.toString()}ms (arm braked, no foot strike)"
            // A drop has no push; its jump is judged on the landing alone
            allowDrops && ratio < MIN_PUSH_RATIO -> null
            ratio < (if (inPlace) MIN_PUSH_RATIO else PLYO_MIN_PUSH_RATIO) || ratio > maxPushRatio(PLYO_MAX_PUSH_RATIO) ->
                "push ${"%.2f".format(ratio)} doesn't fit the flight"
            else -> null
        }
    }

    /**
     * Flight long enough, steadily light, and (with [checkPush]) a push that fits it.
     * Not = ordinary movement.
     */
    private fun shapeOk(checkPush: Boolean = true): Boolean {
        if (flightMs < minFlightMs || flightMs > MAX_FLIGHT_MS) {
            lastRejectReason = "flight ${flightMs}ms"
            return false
        }
        val share = weightlessSamples.toFloat() / max(1, flightSamples)
        if (tuck) {
            // Tuck jumps: the arms break the flight up, but it still holds real light time
            val lightMs = weightlessSamples * (flightMs.toFloat() / max(1, flightSamples))
            if (lightMs < TUCK_MIN_LIGHT_MS || share < TUCK_MIN_LIGHT_SHARE) {
                lastRejectReason = "ragged flight ${"%.2f".format(share)} (tuck, ${lightMs.toInt()}ms light)"
                return false
            }
        } else if (share < MIN_WEIGHTLESS_SHARE && !clearFlight()) {
            // A window stretched by moving arms still passes on enough truly weightless time
            lastRejectReason = "ragged flight ${"%.2f".format(share)}"
            return false
        }
        if (!checkPush) return true
        // Speed needed to stay up that long: v = g·t/2
        val needed = G * (flightMs / 1000f) / 2f
        val ratio = pushSpeed / needed
        if (ratio < MIN_PUSH_RATIO || ratio > maxPushRatio(MAX_PUSH_RATIO)) {
            lastRejectReason = "push ${"%.2f".format(ratio)}"
            return false
        }
        return true
    }

    /**
     * The push before take-off:
     *   [pushSpeed] upward speed gained, the largest sum of (|a| - g)·dt over a stretch that
     *               ends at take-off, within [PUSH_WINDOW_MS] (size of the acceleration
     *               only, so it works whatever way the wrist is turned)
     *   [pushMs]    longest stretch over [PUSH_LEVEL] ending within [PUSH_END_GAP_MS] of take-off
     *   [pushSpin]  mean wrist spin over that stretch
     */
    private fun measurePush(takeoff: Long) {
        var v = 0f
        var best = 0f
        var later = takeoff
        var runEnd = 0L
        var runMs = 0L
        var runSpin = 0f
        var runSamples = 0
        var longest = 0L
        var longestSpin = 0f
        for (k in 0 until bufCount) {
            val i = (bufHead - 1 - k + BUFFER) % BUFFER
            val t = timeBuf[i]
            if (takeoff - t > PUSH_WINDOW_MS) break
            val dt = ((later - t).coerceIn(0L, 50L)) / 1000f
            v += (magBuf[i] - G) * dt
            if (v > best) best = v
            later = t
            if (magBuf[i] > PUSH_LEVEL) {
                if (runEnd == 0L) { runEnd = t; runSpin = 0f; runSamples = 0 }
                runMs = runEnd - t
                // Spin of the final drive only: out of a rebound the stretch also holds the
                // landing before it, with the arms swinging across the body
                if (runMs <= PUSH_SPIN_WINDOW_MS) {
                    runSpin += spinBuf[i]
                    runSamples++
                }
                if (takeoff - runEnd <= PUSH_END_GAP_MS && runMs >= longest) {
                    longest = runMs
                    longestSpin = runSpin / max(1, runSamples)
                }
            } else {
                runEnd = 0L
                runMs = 0L
            }
        }
        pushSpeed = best
        pushMs = longest
        pushSpin = longestSpin
    }

    private fun remember(magnitude: Float, now: Long, spin: Float) {
        magBuf[bufHead] = magnitude
        spinBuf[bufHead] = spin
        timeBuf[bufHead] = now
        bufHead = (bufHead + 1) % BUFFER
        if (bufCount < BUFFER) bufCount++
    }
}
