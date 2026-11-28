package com.example.smartathlete.tracking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Self-checks with idealised, generated signals. They prove the plumbing (detector, gap
 * handling, replay harness) behaves as designed. They say NOTHING about real-world accuracy:
 * only the labelled recordings in ReplayAccuracyTest do.
 */
class JumpSyntheticTest {

    private val g = 9.80665f

    /** A generated wrist signal: (time ms, |a| m/s², wrist spin rad/s) at 100 Hz */
    private class Signal {
        val t = mutableListOf<Long>(); val a = mutableListOf<Float>(); val spin = mutableListOf<Float>()
        var now = 1_000L
        fun hold(ms: Long, mag: Float, s: Float = 0.2f): Signal {
            repeat((ms / 10).toInt()) { t += now; a += mag; spin += s; now += 10 }
            return this
        }
        fun skip(ms: Long): Signal { now += ms; return this }
    }

    /** Push ~1.5 g for 250 ms, ~0.1 g flight, ~3 g foot strike, legs absorbing, then standing. */
    private fun Signal.jump(flightMs: Long = 300, flightSpin: Float = 0.5f, pushMs: Long = 250, gapInFlight: Long = 0, landG: Float = 3f): Signal {
        hold(500, g)
        hold(pushMs, 1.5f * g)
        if (gapInFlight > 0) { hold(flightMs / 2, 0.1f * g, flightSpin); skip(gapInFlight); hold(flightMs / 2 - gapInFlight, 0.1f * g, flightSpin) }
        else hold(flightMs, 0.1f * g, flightSpin)
        hold(30, landG * g)
        hold(170, 1.3f * g)
        return hold(700, g)
    }

    private class Run(val jumps: Int, val swings: Int, val reasons: List<String>)

    /**
     * A tuck jump as the wrist feels it (recorded 2026-11-26): a long leg push, then a flight
     * broken up by the hands meeting the knees (light, a ~1.6 g jolt, light again), then a hard
     * foot strike.
     */
    private fun Signal.tuckJump(): Signal {
        hold(500, g)
        hold(450, 1.5f * g)
        hold(120, 0.5f * g, 1.5f)
        hold(80, 1.6f * g, 2.5f)
        hold(100, 0.7f * g, 1.5f)
        hold(30, 3.5f * g)
        hold(170, 1.3f * g)
        return hold(700, g)
    }

    @Test
    fun tuckJumpWithItsBrokenUpFlightCountsInTuckMode() {
        assertEquals("judged as a jump in place, the hands' jolt in the air ends the flight", 0, run(Signal().tuckJump()).jumps)
        val r = run(Signal().tuckJump(), armSwing = true, tuck = true)
        assertEquals(r.reasons.joinToString("\n"), 1, r.jumps)
    }

    @Test
    fun tuckModeStillNeedsALegPushAndAFootStrike() {
        // The same broken-up "flight" from an arm alone: a flick for a push, no foot strike
        val flick = Signal().hold(500, g).hold(80, 1.5f * g)
            .hold(120, 0.5f * g, 1.5f).hold(80, 1.6f * g, 2.5f).hold(100, 0.7f * g, 1.5f)
            .hold(30, 3.5f * g).hold(170, 1.3f * g).hold(700, g)
        assertEquals(0, run(flick, armSwing = true, tuck = true).jumps)
        val soft = Signal().hold(500, g).hold(450, 1.5f * g)
            .hold(120, 0.5f * g, 1.5f).hold(80, 1.6f * g, 2.5f).hold(100, 0.7f * g, 1.5f)
            .hold(300, 1.3f * g).hold(700, g)
        assertEquals(0, run(soft, armSwing = true, tuck = true).jumps)
    }

    private fun run(sig: Signal, armSwing: Boolean = false, tuck: Boolean = false): Run {
        val d = JumpDetector().apply { this.armSwing = armSwing; this.tuck = tuck }
        val reasons = mutableListOf<String>()
        d.log = { reasons += it }
        var jumps = 0; var swings = 0
        for (i in sig.t.indices) {
            if (d.onSample(sig.a[i], sig.t[i], sig.spin[i])) jumps++
            else if (d.swingRejected) swings++
        }
        return Run(jumps, swings, reasons)
    }

    @Test
    fun cleanJumpIsCounted() {
        val r = run(Signal().jump())
        assertEquals(r.reasons.joinToString("\n"), 1, r.jumps)
        assertEquals(0, r.swings)
    }

    @Test
    fun softLandingAfterAClearFlightCounts() {
        // "Land softly": 1.5 g at the wrist after 300 ms truly weightless
        val r = run(Signal().jump(flightMs = 300, landG = 1.5f))
        assertEquals(r.reasons.joinToString("\n"), 1, r.jumps)
    }

    @Test
    fun landingWithNoImpactAtAllIsStillRejected() {
        // Even after a clear flight, 1.2 g isn't a landing
        assertEquals(0, run(Signal().jump(flightMs = 300, landG = 1.2f)).jumps)
    }

    @Test
    fun resetJumpsWithAWalkBackBetweenThemCount() {
        // Broad / vertical jumps with ~12 s to walk back and reset between them
        val sig = Signal()
        repeat(3) { sig.jump(); sig.hold(10_500, g) }
        val f = File.createTempFile("synthetic_reset", ".csv")
        try {
            f.bufferedWriter().use { w ->
                w.write("# profile=jump\n# drill=Vertical jumps\n# gyro=true\n# barometer=false\n# hrSensor=true\n")
                w.write("H,${sig.t.first()},135\n")
                for (i in sig.t.indices) w.write("S,${sig.t[i]},0,0,${sig.a[i]},0,0,${sig.spin[i]},1\n")
            }
            val s = ReplayHarness.replay(f).segments[0]
            assertEquals(s.notes.joinToString("\n"), 3, s.jumps)
        } finally {
            f.delete()
        }
    }

    @Test
    fun armFlickWithoutLegPushIsRejectedAsFake() {
        // Big enough to fit the flight, but over in ~0.1 s: an arm, not legs extending
        val r = run(Signal().jump(pushMs = 100))
        assertEquals(0, r.jumps)
        assertEquals(r.reasons.joinToString("\n"), 1, r.swings)
    }

    @Test
    fun wristWhippedInTheAirIsRejectedAsFake() {
        val r = run(Signal().jump(flightSpin = 7f))
        assertEquals(0, r.jumps)
        assertEquals(1, r.swings)
    }

    @Test
    fun armsDrivenThroughTheFlightCountOnlyInArmSwingDrills() {
        // ~6.5 rad/s for 350 ms = ~2.2 rad (~130°) of wrist turn: a bound / broad jump arm swing
        val sig = Signal().jump(flightMs = 350, flightSpin = 6.5f)
        assertEquals("jump in place: that much turn is an arm swing", 0, run(sig).jumps)
        val r = run(sig, armSwing = true)
        assertEquals(r.reasons.joinToString("\n"), 1, r.jumps)
    }

    @Test
    fun armSwingDrillStillRejectsAWhippedWrist() {
        val r = run(Signal().jump(flightSpin = 12f), armSwing = true)
        assertEquals(0, r.jumps)
        assertEquals(1, r.swings)
    }

    /** Writes [sig] as a DiagnosticRecorder file for [profile] / [drill], heart rate [bpm]. */
    private fun recording(sig: Signal, profile: String, drill: String, bpm: Int): File {
        val f = File.createTempFile("synthetic_$profile", ".csv")
        f.bufferedWriter().use { w ->
            w.write("# profile=$profile\n# drill=$drill\n# gyro=true\n# barometer=false\n# hrSensor=true\n")
            w.write("H,${sig.t.first()},$bpm\n")
            for (i in sig.t.indices) w.write("S,${sig.t[i]},0,0,${sig.a[i]},0,0,${sig.spin[i]},1\n")
        }
        return f
    }

    @Test
    fun skaterBoundsWithAStickBetweenThemCount() {
        // Each bound: arms across the body in the air, then ~1.4 s on the landing leg before
        // the next one. Too long for a rebound, so before the fix the run never got going.
        val sig = Signal()
        repeat(4) { sig.jump(flightMs = 350, flightSpin = 5f) }
        val f = recording(sig, "plyo", "Skater bounds", 150)
        try {
            val s = ReplayHarness.replay(f).segments[0]
            // Counted, or waiting for the heart rate to rise with the set (it can't in 6 s here)
            assertEquals(s.notes.joinToString("\n"), 4, s.jumps + s.pendingJumps)
            assertEquals(s.notes.joinToString("\n"), 0, s.jumpsRejected)
        } finally {
            f.delete()
        }
    }

    /** 4 skater bounds through a fresh tracker with the heart rate at [bpm]. */
    private fun liveTracker(bpm: Int): Pair<WorkoutSensorTracker, Signal> {
        val t = WorkoutSensorTracker(null)
        t.startReplay(SensorProfile.PLYO, "Skater bounds", gyro = true, barometer = false, hrSensor = true)
        val sig = Signal()
        repeat(4) { sig.jump(flightMs = 350, flightSpin = 2f) }
        t.replayHeartRate(sig.t.first(), bpm)
        for (i in sig.t.indices) t.replaySample(sig.t[i], 0f, 0f, sig.a[i], 0f, 0f, sig.spin[i], true)
        return t to sig
    }

    @Test
    fun jumpsShowLiveAndStayWhenTheHeartRateBacksThem() {
        val (t, sig) = liveTracker(100)
        assertEquals("shown the moment they land, not after the heart rate rises", 4, t.jumps)
        assertEquals(0, t.confirmedJumpCount)
        t.replayHeartRate(sig.now + 5_000, 150)
        assertEquals(4, t.jumps)
        assertEquals(4, t.confirmedJumpCount)
        assertEquals(0, t.jumpsRejected)
    }

    /**
     * A plyo set of 4 skater bounds after the heart rate readings [before] (bpm, one every 3 s,
     * ending as the set starts), through a fresh tracker.
     */
    private fun plyoSetAfter(before: List<Int>): Pair<WorkoutSensorTracker, Signal> {
        val t = WorkoutSensorTracker(null)
        t.startReplay(SensorProfile.PLYO, "Skater bounds", gyro = true, barometer = false, hrSensor = true)
        val sig = Signal().skip(before.size * 3_000L)
        repeat(4) { sig.jump(flightMs = 350, flightSpin = 2f) }
        before.forEachIndexed { i, bpm -> t.replayHeartRate(1_000L + i * 3_000L, bpm) }
        for (i in sig.t.indices) t.replaySample(sig.t[i], 0f, 0f, sig.a[i], 0f, 0f, sig.spin[i], true)
        return t to sig
    }

    @Test
    fun plyoFirstInTheSessionCountsOnItsOwnRise() {
        // Cold start: resting ~82. Ten hops take it to ~92, nowhere near the 120 that other
        // jumps need, nor 18 above the drill start: the set's own rise is what counts
        val (t, sig) = plyoSetAfter(listOf(83, 82, 82, 84))
        t.replayHeartRate(sig.now + 3_000, 92)
        assertEquals(4, t.confirmedJumpCount)
        assertEquals(0, t.jumpsRejected)
    }

    @Test
    fun plyoAfterAHardDrillCountsFromTheRestingLevel() {
        // 2026-11-26: the drill started at 126 (the last drill left it high), it fell to ~88 in
        // the rest, and real single-leg hops took it to ~100 — needed 129 and none counted.
        // The set is judged against the lowest reading before it, not the drill start
        val (t, sig) = plyoSetAfter(listOf(126, 118, 104, 95, 89, 88, 90, 93))
        t.replayHeartRate(sig.now + 3_000, 98)
        assertEquals(4, t.confirmedJumpCount)
        assertEquals(0, t.jumpsRejected)
    }

    @Test
    fun plyoSetWithoutAHeartRateRiseStillDoesntCount() {
        // An arm faking jumps barely moves the heart rate: still held, then taken back out
        val (t, sig) = plyoSetAfter(listOf(82, 82, 83, 82))
        t.replayHeartRate(sig.now + 3_000, 86)
        assertEquals(0, t.confirmedJumpCount)
        t.replayHeartRate(sig.now + 95_000, 86)
        assertEquals(0, t.jumps)
        assertEquals(4, t.jumpsRejected)
    }

    @Test
    fun liveJumpsAreTakenBackIfTheHeartRateNeverRises() {
        val (t, sig) = liveTracker(100)
        assertEquals(4, t.jumps)
        t.replayHeartRate(sig.now + 95_000, 100)
        assertEquals("not backed within 90 s: taken back out", 0, t.jumps)
        assertEquals(4, t.jumpsRejected)
    }

    /**
     * Push-up-shaped wrist signal through a fresh tracker: gravity [forearmG] along the forearm
     * (watch x), the forearm tilted (y -0.3 g, z +0.4 g) between reps and upright (y, z ~0.08 g)
     * for ~0.3 s each rep, every 1.4 s. [stopAfter] reps fed (default all [reps]).
     */
    private fun pushUps(reps: Int, forearmG: Float = -0.93f, spin: Float = 0.8f, stopAfter: Int = reps): WorkoutSensorTracker {
        val t = WorkoutSensorTracker(null)
        t.startReplay(SensorProfile.REPS, "Push-ups", gyro = true, barometer = false, hrSensor = true)
        var now = 1_000L
        fun hold(ms: Long, y: Float, z: Float) = repeat((ms / 10).toInt()) {
            t.replaySample(now, forearmG * g, y * g, z * g, 0.1f, spin, 0.2f, true); now += 10
        }
        fun ramp(ms: Long, y0: Float, z0: Float, y1: Float, z1: Float) {
            val n = (ms / 10).toInt()
            for (i in 0 until n) {
                val f = i / n.toFloat()
                t.replaySample(now, forearmG * g, (y0 + f * (y1 - y0)) * g, (z0 + f * (z1 - z0)) * g, 0.1f, spin, 0.2f, true); now += 10
            }
        }
        hold(3_000, -0.3f, 0.4f)
        repeat(stopAfter) {
            ramp(150, -0.3f, 0.4f, -0.08f, 0.08f); hold(150, -0.08f, 0.08f)
            ramp(150, -0.08f, 0.08f, -0.3f, 0.4f); hold(950, -0.3f, 0.4f)
        }
        return t
    }

    @Test
    fun pushUpsWithTheHandPlantedCount() {
        val t = pushUps(8)
        assertEquals(8, t.confirmedRepCount)
        assertEquals(8, t.reps)
    }

    @Test
    fun firstPushUpsOfASetShowLiveBeforeTheSetIsEstablished() {
        val t = pushUps(8, stopAfter = 2)
        assertEquals("held until 3 in a row, but shown at once", 2, t.reps)
        assertEquals(0, t.confirmedRepCount)
    }

    @Test
    fun handWavedWithTheForearmLevelIsNotAPushUp() {
        // Same tilt cycles, but the forearm lies level (little gravity along it): not on the floor
        assertEquals(0, pushUps(8, forearmG = 0.1f).confirmedRepCount)
    }

    @Test
    fun forearmWhippedEachRepIsNotAPushUp() {
        assertEquals(0, pushUps(8, spin = 6f).confirmedRepCount)
    }

    @Test
    fun pogoHopsWithLongPausesStillDoNotLink() {
        // Rebound drills are unchanged: hops 1.4 s apart aren't a run of rebounds
        val sig = Signal()
        repeat(4) { sig.jump(flightMs = 350) }
        val f = recording(sig, "plyo", "Pogo hops", 150)
        try {
            val s = ReplayHarness.replay(f).segments[0]
            assertEquals(s.notes.joinToString("\n"), 0, s.jumps + s.pendingJumps)
        } finally {
            f.delete()
        }
    }

    @Test
    fun missingReadingsDuringFlightDropTheJumpWithoutCallingItFake() {
        val r = run(Signal().jump(gapInFlight = 70))
        assertEquals(0, r.jumps)
        assertEquals("a sensor gap must not count as cheating", 0, r.swings)
        assertTrue(r.reasons.joinToString("\n"), r.reasons.any { "sensor gap" in it })
    }

    @Test
    fun jumpRightAfterAGapIsNotCounted() {
        // Readings lost while standing just before the push: the push can't be measured
        val sig = Signal().hold(500, g).skip(100)
        sig.hold(250, 1.5f * g).hold(300, 0.1f * g, 0.5f).hold(30, 3f * g).hold(170, 1.3f * g).hold(700, g)
        val r = run(sig)
        assertEquals(0, r.jumps)
        assertEquals(0, r.swings)
    }

    /** Writes a DiagnosticRecorder-format file and replays it through the whole tracker. */
    @Test
    fun replayHarnessRunsTheFullTrackerRules() {
        val sig = Signal()
        repeat(4) { sig.jump() }
        val f = File.createTempFile("synthetic_jump", ".csv")
        try {
            f.bufferedWriter().use { w ->
                w.write("# profile=jump\n# drill=Tuck jumps\n# gyro=true\n# barometer=false\n# hrSensor=true\n")
                w.write("H,${sig.t.first()},135\n")
                for (i in sig.t.indices) w.write("S,${sig.t[i]},0,0,${sig.a[i]},0,0,${sig.spin[i]},1\n")
            }
            val rec = ReplayHarness.replay(f)
            assertEquals(1, rec.segments.size)
            val s = rec.segments[0]
            // First jump is held until the second follows, then all four count (heart rate 135 backs them)
            assertEquals(s.notes.joinToString("\n"), 4, s.jumps)
            assertEquals(0, s.jumpsRejected)
            assertFalse(s.notes.isEmpty())
        } finally {
            f.delete()
        }
    }

    @Test
    fun singleJumpWithoutASecondIsHeldNotCounted() {
        val sig = Signal().jump()
        val f = File.createTempFile("synthetic_single", ".csv")
        try {
            f.bufferedWriter().use { w ->
                w.write("# profile=jump\n# gyro=true\n# barometer=false\n# hrSensor=true\n")
                w.write("H,${sig.t.first()},135\n")
                for (i in sig.t.indices) w.write("S,${sig.t[i]},0,0,${sig.a[i]},0,0,${sig.spin[i]},1\n")
            }
            assertEquals(0, ReplayHarness.replay(f).segments[0].jumps)
        } finally {
            f.delete()
        }
    }
}
