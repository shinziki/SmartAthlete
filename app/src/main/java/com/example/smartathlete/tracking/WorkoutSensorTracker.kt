package com.example.smartathlete.tracking

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import android.util.Log
import androidx.annotation.VisibleForTesting
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Runs the watch sensors that suit the current workout's [SensorProfile] and keeps
 * session totals across profile switches. State is Compose-observable so the
 * tracking screen recomposes as readings arrive.
 *
 * Sensor callbacks arrive on the main thread (no handler is passed to registerListener).
 */
class WorkoutSensorTracker(private val sensorManager: SensorManager?) {

    /**
     * How a rep exercise moves the wrist, from the drill's name:
     *   [minSwing]    smallest wrist tilt either side of rest that counts (m/s² of gravity)
     *   [minRepMs]    fastest believable rep; [maxRepMs] slowest (also the longest pause
     *                 between reps that keeps the set going)
     *   [needsImpact] the feet land during each rep (jumping jacks, burpees)
     */
    enum class RepStyle(val minSwing: Float, val minRepMs: Long, val maxRepMs: Long, val needsImpact: Boolean) {
        // Counted from the forearm's tilt cycles instead (PUSH_UP_CYCLE, see detectRep); minSwing unused
        PUSH_UP(2.2f, 700L, 6_000L, false),
        // Torso (and the wrist on the chest) turns ~60-90°: small arm moves while sitting don't
        SIT_UP(3.5f, 900L, 8_000L, false),
        SQUAT(1.8f, 800L, 6_000L, false),
        // Arms go overhead and the feet land every rep
        JACK(3.5f, 350L, 3_000L, true),
        BURPEE(2.5f, 1_200L, 8_000L, true),
        GENERIC(2.2f, 600L, 6_000L, false);

        companion object {
            fun forDrill(name: String?): RepStyle {
                val n = name?.lowercase() ?: return GENERIC
                return when {
                    "jack" in n -> JACK
                    "burpee" in n -> BURPEE
                    "push" in n || "press-up" in n || "press up" in n -> PUSH_UP
                    "sit-up" in n || "sit up" in n || "situp" in n || "crunch" in n -> SIT_UP
                    "squat" in n || "lunge" in n -> SQUAT
                    else -> GENERIC
                }
            }
        }
    }

    /** How the current drill's reps are counted; set from the drill name ([setDrillName]). */
    var repStyle = RepStyle.GENERIC; private set
    private var repStyleVersion = 0

    /**
     * The kinds of plyometric drill, which decide how a plyometric jump is verified
     * (the standard progression: jumps in place / multiple hops / bounds, standing jumps,
     * box drills, depth jumps):
     *   [REBOUND]  runs of quick rebounds: pogo hops, hurdle hops, bounding, split-squat jumps
     *   [RESET]    one max-effort jump at a time with a reset between: countermovement jumps,
     *              standing broad / lateral jumps
     *   [BOX]      jumping up onto a box: the barometer must show the athlete landed higher
     *   [DEPTH]    stepping off a box and jumping straight out of the landing: the barometer
     *              must show the athlete came down from a box
     * Skater and lateral bounds are coached both ways (push straight back, or stick each
     * landing for a moment first), so they link either as rebounds or as max-effort jumps.
     */
    enum class PlyoStyle {
        REBOUND, RESET, BOX, DEPTH;

        companion object {
            private val REBOUND_WORDS = listOf("pogo", "hop", "bound", "repeated", "continuous", "split", "zig", "ankle")
            private val RESET_WORDS = listOf("countermovement", "standing", "broad", "vertical", "squat", "tuck", "jump")
            /**
             * Done continuously or with a stick between bounds. A stuck landing holds the
             * athlete on the ground well past a rebound's contact, so as REBOUND only, every
             * bound would break the run and none would count.
             */
            private val EITHER_WORDS = listOf("skater", "lateral bound")
            /**
             * Drills that drive the arms hard through the flight (across the body, or from
             * behind to in front), see JumpDetector.armSwing. Squat jumps / jump squats: the
             * arms are swung up from the squat into each jump.
             */
            private val ARM_SWING_WORDS = listOf("bound", "broad", "skater", "lateral jump", "squat jump", "jump squat", "tuck")

            private fun forWorkout(w: String): Set<PlyoStyle>? = when {
                "depth" in w || "drop jump" in w -> setOf(DEPTH)
                "box" in w -> setOf(BOX)
                EITHER_WORDS.any { it in w } -> setOf(REBOUND, RESET)
                REBOUND_WORDS.any { it in w } -> setOf(REBOUND)
                RESET_WORDS.any { it in w } -> setOf(RESET)
                else -> null
            }

            /**
             * Styles allowed in a drill. The phone names a drill after the coach's picked
             * workouts ("Pogo hops, Box jumps"); a name with an unknown part allows them all.
             */
            fun forDrill(name: String?): Set<PlyoStyle> {
                val parts = name?.lowercase()?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }
                if (parts.isNullOrEmpty()) return entries.toSet()
                val styles = parts.map { forWorkout(it) }
                return if (styles.any { it == null }) entries.toSet() else styles.filterNotNull().flatten().toSet()
            }

            /** True when any workout in the drill swings the arms hard through each jump. */
            fun armSwing(name: String?): Boolean {
                val n = name?.lowercase() ?: return false
                return ARM_SWING_WORDS.any { it in n }
            }

            /** Jumps done on the spot (see JumpDetector.inPlace); not bounds, broad or box jumps. */
            private val IN_PLACE_WORDS = listOf("squat", "tuck", "vertical", "countermovement", "cmj", "star jump")
            private val TRAVEL_WORDS = listOf("broad", "bound", "skater", "lateral", "box", "depth", "drop")

            fun inPlace(name: String?): Boolean {
                val parts = name?.lowercase()?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }
                if (parts.isNullOrEmpty()) return false
                // Every workout in the drill must be one; a mix keeps the stricter checks
                return parts.all { p -> IN_PLACE_WORDS.any { it in p } && TRAVEL_WORDS.none { it in p } }
            }

            /** True when the drill is tuck jumps (see JumpDetector.tuck). */
            fun tuck(name: String?): Boolean = name?.lowercase()?.contains("tuck") == true
        }
    }

    /** Plyometric styles of the current drill (from its name, see [setDrillName]). */
    var plyoStyles: Set<PlyoStyle> = PlyoStyle.entries.toSet(); private set

    fun setDrillName(name: String?) {
        if (name != drillName) {
            drillName = name
            note("drill", "Drill '$name'")
        }
        val style = RepStyle.forDrill(name)
        if (style != repStyle) {
            repStyle = style
            repStyleVersion += 1
            Log.d(TAG, "Rep style $style for '$name'")
        }
        val plyo = PlyoStyle.forDrill(name)
        if (plyo != plyoStyles) {
            plyoStyles = plyo
            Log.d(TAG, "Plyometric styles $plyo for '$name'")
        }
        applyPlyoStyles()
    }

    /**
     * Styles actually checked: box and depth jumps can only be confirmed by the barometer, so
     * without one they're judged as ordinary max-effort jumps (hard landing on the ground side).
     */
    private fun effectivePlyoStyles(): Set<PlyoStyle> =
        if (hasBarometer) plyoStyles
        else plyoStyles.map { if (it == PlyoStyle.BOX || it == PlyoStyle.DEPTH) PlyoStyle.RESET else it }.toSet()

    private fun applyPlyoStyles() {
        val styles = effectivePlyoStyles()
        val plyo = profile.plyometric
        jumpDetector.plyometric = plyo
        jumpDetector.allowSoftLanding = plyo && PlyoStyle.BOX in styles
        jumpDetector.allowDrops = plyo && PlyoStyle.DEPTH in styles
        // Jumping drills too (broad jumps, skater jumps), not only plyometrics
        jumpDetector.armSwing = PlyoStyle.armSwing(drillName)
        jumpDetector.tuck = PlyoStyle.tuck(drillName)
        jumpDetector.inPlace = PlyoStyle.inPlace(drillName)
    }

    companion object {
        private const val TAG = "WorkoutSensorTracker"
        private const val GRAVITY = SensorManager.GRAVITY_EARTH

        // 100 Hz accelerometer: the rate PlayerLoad is defined at
        private const val ACCEL_PERIOD_US = 10_000
        // Let the sensor hub batch samples and deliver them in groups instead of waking the
        // app 100 times a second; event timestamps keep detection exact
        private const val ACCEL_MAX_LATENCY_US = 200_000

        // Movement: dynamic acceleration above this marks the athlete as moving
        private const val MOVING_THRESHOLD = 0.65f
        private const val STILL_AFTER_MS = 2_500L

        // Accelerometer step detection (lateral slides, or watches without a step counter)
        private const val ACCEL_STEP_THRESHOLD = 2.3f
        private const val ACCEL_STEP_MIN_GAP_MS = 280L

        // Jumps: each one must look like a real jump (JumpDetector) AND the heart rate must
        // back them up, so swinging the watch by hand while sitting doesn't count.
        // No jump counts on the wrist alone: an arm can fake one. Jumps wait until the heart
        // rate shows real effort, then all of them count at once (the heart rate lags ~20-60 s)
        private const val FREE_JUMPS_PER_DRILL = 0
        // Heart rate that shows real effort: at least this, or this much above the drill start.
        // Swinging an arm while standing raises the heart rate a little; jumping raises it a lot.
        private const val JUMP_ACTIVE_HR = 120
        private const val JUMP_HR_RISE = 18
        // Jumps waiting this long without the heart rate rising are dropped
        private const val JUMP_PENDING_MAX_MS = 90_000L
        private const val GYRO_PERIOD_US = 20_000
        // Heart-rate-only wrist contact: a dropout shorter than this doesn't stop counting
        private const val CONTACT_DROPOUT_GRACE_MS = 3_000L

        // Rep counting: a rep tilts the wrist one way and back, which shows up as a slow
        // swing of gravity along one accelerometer axis. Smooth out impacts, remove the
        // resting orientation, then count one rep per full swing on the busiest axis.
        private const val REP_SMOOTH_S = 0.12f
        private const val REP_BASELINE_S = 5f
        // A rep must come in a rhythm: a lone movement (raising a hand, settling into position)
        // isn't counted. Reps are held until this many in a row, then all of them count.
        private const val REP_STREAK_TO_COUNT = 3
        // Consecutive reps may differ in size at most this much (a real set is regular)
        private const val REP_MAX_SIZE_RATIO = 2.5f
        // Jumping jacks / burpees: the feet must hit the ground during each rep (~1.6 g)
        private const val REP_IMPACT = 15.7f

        // Push-ups: the hand is planted on the floor. The forearm then stands near vertical
        // (watch x axis, 9 o'clock to 3 o'clock, runs along the forearm: the strap at 12 and 6
        // wraps around the wrist; recorded push-ups on a Galaxy Watch 5 hold ~0.9-1 g on x and
        // ~0.1-0.4 g on y), the wrist is the pivot so it hardly moves, and the forearm doesn't
        // turn around its own axis.
        // A hand twisted or an arm waved in the air fails at least one of these.
        /**
         * One push-up = the forearm's tilt (gravity across it, m/s²) dips at least this much and
         * comes back as much. Recorded sets dip ~2.9-5.9 each rep; holding the plank moves it
         * well under this.
         */
        private const val PUSH_UP_CYCLE = 1.5f
        /** Gravity along the forearm, averaged over the rep (~0.55 g = within ~57° of vertical) */
        private const val PUSH_UP_MIN_FOREARM_G = 0.55f
        /** Rotation around the forearm (twisting the hand) during the rep, radians (~30°) */
        private const val PUSH_UP_MAX_TWIST = 0.5f
        /** ...and at most this share of all rotation in the rep */
        private const val PUSH_UP_MAX_TWIST_SHARE = 0.45f
        /**
         * Fastest wrist rotation in a push-up (rad/s); a flick or wave is faster. Recorded
         * push-ups peak at ~2.3-3.3; getting into / out of position whips it ~7-8.
         */
        private const val PUSH_UP_MAX_SPIN = 4.0f
        /** Wrist acceleration besides gravity (m/s², ~0.35 g): a planted hand barely moves */
        private const val PUSH_UP_MAX_MOVE = 3.5f

        // Sit-ups (arms crossed on the chest): the whole torso lifts ~60-90°. The forearms lie
        // across the chest, so the watch turns around the forearm, rides on the chest without
        // swinging, and at the bottom (lying back) its face points up at the ceiling.
        // Moving a hand or arm while sitting fails at least one of these.
        /** Tilt of the watch over the rep (gravity change, m/s²; ~6 = ~40°) */
        private const val SIT_UP_MIN_SIZE = 6.0f
        /** Lying back at the bottom: gravity into the watch face at least this (~0.7 g = within ~45° of flat) */
        private const val SIT_UP_MIN_LYING_G = 0.7f
        /** Total torso rotation over the rep, radians (~35°) */
        private const val SIT_UP_MIN_TURN = 0.6f
        /** Share of that rotation around the forearm (arms across the chest turn with the torso) */
        private const val SIT_UP_MIN_AXIS_SHARE = 0.45f
        /** Fastest believable torso rotation (rad/s); an arm flick is faster */
        private const val SIT_UP_MAX_SPIN = 4.0f
        /** Wrist acceleration besides gravity (m/s², ~0.6 g): the wrist rides on the chest */
        private const val SIT_UP_MAX_MOVE = 6.0f
        /** Forearm across the chest stays level: gravity along it at most this, on average
         *  (~0.6 g = tilted under ~37°). A raised hand points the forearm up. */
        private const val SIT_UP_MAX_FOREARM_G = 0.6f

        // Jumps also come in a series: a lone jump-like movement waits for a second one.
        // Reset drills (broad jumps "then walk back", vertical jumps "land and reset") take
        // ~8-15 s between jumps; at 8 s every one of them was a "lone" jump and none counted.
        private const val JUMP_STREAK_GAP_MS = 15_000L

        // Plyometrics: stricter than jumps. Every jump passes JumpDetector's plyometric checks,
        // then is verified for its drill style (PlyoStyle) and must be part of a set (a "run"):
        //  - a jump links to the one before when
        //      REBOUND  the ground contact between them is a rebound's: 60-800 ms
        //      RESET    it is a max-effort jump (flight >= PLYO_RESET_MIN_FLIGHT_MS, ~10 cm)
        //               within PLYO_RESET_MAX_GAP_MS of the last one's landing
        //      BOX / DEPTH  confirmed by the barometer, within PLYO_RESET_MAX_GAP_MS
        //  - nothing counts until PLYO_RUN_TO_COUNT jumps in a row are linked; a broken run
        //    starts over and the jumps held in it are not counted
        //  - each run's jumps count only once the heart rate rises PLYO_SET_HR_RISE above the
        //    athlete's resting level before the run: the lowest reading in the
        //    PLYO_HR_BASELINE_MS before it started. A real set of explosive jumps always does
        //    that; an arm faking them doesn't.
        //    Not the drill-wide JUMP_ACTIVE_HR / JUMP_HR_RISE on top: a short plyo set (10 hops
        //    in ~10 s) rarely takes the heart rate to 120, nor 18 above a drill start that the
        //    last drill left high (2026-11-26: 9 real single-leg hops, heart rate 88 → 100,
        //    needed 129, none counted), and a session can open with plyometrics, cold.
        private const val PLYO_RUN_TO_COUNT = 3
        /**
         * Jumps in place (squat / tuck jumps): two in a row are a set. Athletes who can't keep
         * up a rhythm lost whole sets to "run broken" (pilot 2026-11-26).
         */
        private const val PLYO_RUN_TO_COUNT_IN_PLACE = 2
        /**
         * Lowest max-effort jump in place, take-off to landing (~6 cm). The light part of the
         * flight alone undersold real squat jumps (arms swung up): 280 ms of it turned down
         * lower jumps by shorter athletes.
         */
        private const val PLYO_IN_PLACE_MIN_AIR_MS = 220L
        private const val PLYO_SET_HR_RISE = 8
        private const val PLYO_HR_BASELINE_MS = 45_000L
        private const val PLYO_RESET_MIN_FLIGHT_MS = 280L
        private const val PLYO_RESET_MAX_GAP_MS = 15_000L

        // Barometer (box / depth jumps): height change from the median pressure while standing
        // before the take-off to the median after the landing. Boxes are 30-75 cm; the wrist
        // height also wanders a little with the arms, so 20 cm is the least that counts.
        private const val BARO_PERIOD_US = 40_000
        private const val BARO_KEEP_MS = 20_000L
        private const val BARO_BEFORE_FROM_MS = 1_500L
        private const val BARO_BEFORE_TO_MS = 300L
        private const val BARO_AFTER_FROM_MS = 300L
        private const val BARO_AFTER_TO_MS = 1_300L
        private const val BARO_MIN_SAMPLES = 3
        /** Barometer readings stopped: judge without them this long after the landing */
        private const val BARO_TIMEOUT_MS = 4_000L
        private const val BOX_MIN_HEIGHT_M = 0.2f

        // Heart-rate continuity (the watch handed to someone else without losing skin
        // contact, e.g. slid from wrist to wrist): one person's heart rate changes smoothly,
        // two people's don't. Median of the last 5 s against the 5 s from 10-15 s earlier.
        private const val HR_RECENT_MS = 5_000L
        private const val HR_BEFORE_FROM_MS = 15_000L
        private const val HR_BEFORE_TO_MS = 10_000L
        // A drop this big that fast isn't recovery (that's ~10-15 bpm in 15 s)…
        private const val HR_DROP_BPM = 30
        // …and a rise this big that fast is beyond even a sprint start
        private const val HR_RISE_BPM = 45
        // The sensor lost its lock this long, then came back at a clearly different rate
        private const val HR_GAP_MS = 3_000L
        private const val HR_GAP_CHANGE_BPM = 25
        private const val HR_ANOMALY_REFRACTORY_MS = 60_000L

        // Cadence / speed rolling window
        private const val WINDOW_MS = 10_000L
        private const val LATERAL_STEP_M = 0.5f
        // Burst speed: the same step-based speed over a short window, so a sprint shows
        // within 1-2 s instead of being averaged away over 10 s
        private const val BURST_WINDOW_MS = 3_000L

        // Acceleration bursts (explosive starts) straight from the accelerometer: the wrist's
        // acceleration besides gravity, smoothed over ~0.3 s, goes from calm (standing,
        // walking) to vigorous within a second. One burst per start: it re-arms once calm.
        private const val ACC_SMOOTH_S = 0.3f
        private const val ACC_CALM = 2.0f        // m/s² (~0.2 g)
        private const val ACC_BURST = 7.0f       // m/s² (~0.7 g)
        private const val ACC_RISE_MS = 1_000L
        private const val ACC_MIN_GAP_MS = 1_500L

        // Wrist orientation from the gravity direction (accelerometer low-passed over ~0.5 s).
        // Watch axes: x runs 9 -> 3 o'clock (along the forearm), z points out of the screen.
        private const val GRAVITY_SMOOTH_S = 0.5f
        /** Forearm within ~30° of vertical: arm hanging at the side or raised overhead */
        private const val ORI_VERTICAL_DEG = 60.0
        /** Screen within ~45° of facing straight up / down */
        private const val ORI_FACE_G = 0.7f
    }

    /** Wrist orientation classes, in the order sent to the phone ("ori"). */
    enum class Orientation { VERTICAL, FACE_UP, FACE_DOWN, SIDE }

    var steps by mutableIntStateOf(0); private set
    var meters by mutableFloatStateOf(0f); private set
    /** 0 until the HR sensor reports a reliable reading with skin contact. */
    var heartRate by mutableIntStateOf(0); private set
    /**
     * Jumps shown live (on the watch, and sent to the phone): every jump the detector accepted,
     * the moment it lands. That includes jumps still being verified, held in a series / run
     * that isn't established yet, or waiting for the heart rate to back them. A jump that fails
     * that verification is taken back out (and added to [jumpsRejected]): at most
     * JUMP_PENDING_MAX_MS later, well within the rest between drills. See [refreshJumps].
     */
    var jumps by mutableIntStateOf(0); private set
    /** Jumps fully verified (series / run established, heart rate backs them). */
    private var confirmedJumps = 0
    /** Jump-like movements not counted because the heart rate didn't rise (sent to the phone). */
    var jumpsRejected = 0; private set
    /**
     * A jump the heart rate hasn't backed up yet: when it was seen, and the heart rate it
     * needs (plyometric runs: resting level before the run + PLYO_SET_HR_RISE; 0 = none), and
     * the drill it belongs to ([drillSeq]). See [hrBacks].
     */
    private class PendingJump(val at: Long, val needHr: Int, val drill: Int, val plyo: Boolean)
    private val pendingJumps = ArrayDeque<PendingJump>()
    /** Counts drill starts, so a jump dropped after its drill ended can be taken off the right drill. */
    private var drillSeq = 0

    /** Updates the live [jumps]: verified + waiting for the heart rate + held in a series / run. */
    private fun refreshJumps() {
        jumps = confirmedJumps + pendingJumps.size + (if (loneJumpHeld) 1 else 0) + max(0, plyoRunHeld)
    }
    /** Average ground contact (ms) of the rebounds counted in this plyometric drill; 0 = none yet. */
    var groundContactMs by mutableIntStateOf(0); private set
    private var contactSumMs = 0L
    private var contactCount = 0
    // The plyometric run being built: jumps seen in it (held until PLYO_RUN_TO_COUNT; -1 =
    // the run is established and each further jump counts), their ground contacts (-1 = not a
    // rebound), the heart rate at its start, and the last landing in it (accelerometer time)
    private var plyoRunHeld = 0
    private val plyoRunContacts = mutableListOf<Long>()
    private var plyoRunStartHr = 0
    private var plyoRunLandingAt = 0L
    /** Recent heart-rate readings (clock ms, bpm), for the resting level before a plyo run. */
    private val hrHistory = ArrayDeque<Pair<Long, Int>>()
    // Plyometric jumps waiting for the barometer (in order), and a jump down off a box
    // (depth jump done with a little hop off the box) waiting for the jump out of its landing
    private val plyoQueue = ArrayDeque<JumpDetector.JumpInfo>()
    private var downJump: JumpDetector.JumpInfo? = null
    // Barometer: recent (time ms, hPa)
    private var hasBarometer = false
    private val baroSamples = ArrayDeque<Pair<Long, Float>>()
    private var drillJumpCandidates = 0
    private var drillStartHr = 0
    private var hasHrSensor = false
    private val jumpDetector = JumpDetector().apply {
        log = {
            Log.d("JumpDetector", it)
            diagnostics?.event(lastSensorMs, "jump_judge", it)
            onNote?.invoke("jump_judge", it)
        }
    }

    /** Time source for the counting logic (ms); replaced only by offline replay (unit tests). */
    private var clock: () -> Long = { SystemClock.elapsedRealtime() }

    /** Offline replay (unit tests): every detector decision as (kind, message). */
    @VisibleForTesting
    internal var onNote: ((String, String) -> Unit)? = null

    // ─── Offline replay of DiagnosticRecorder files (unit tests only) ───
    // The same processing as the sensors get, without registering any; time is sensor time.
    private var replayNowMs = 0L
    private var replayHr: HeartRateListener? = null
    private var replayBaro: BarometerListener? = null

    /** Sets up a fresh session for [newProfile] as [reset] + [start] would, with no sensors. */
    @VisibleForTesting
    internal fun startReplay(newProfile: SensorProfile, drill: String?, gyro: Boolean, barometer: Boolean, hrSensor: Boolean) {
        stop()
        clock = { replayNowMs }
        replayNowMs = 0L
        reset()
        profile = newProfile
        hasGyro = gyro
        hasBarometer = barometer
        hasHrSensor = hrSensor
        baroSamples.clear()
        wristSpin = 0f; gyroX = 0f; gyroY = 0f; gyroZ = 0f
        accelListener = AccelListener(newProfile.accelSteps, newProfile.detectJumps, newProfile.countReps)
        replayHr = HeartRateListener()
        replayBaro = BarometerListener()
        aligner.reset(gyroEnabled = gyro)
        setDrillName(drill)
        applyPlyoStyles()
    }

    /** A recorded accelerometer sample (sensor ms) with its already-aligned gyroscope reading. */
    @VisibleForTesting
    internal fun replaySample(t: Long, ax: Float, ay: Float, az: Float, gx: Float, gy: Float, gz: Float, gyroOk: Boolean) {
        replayNowMs = max(replayNowMs, t)
        if (hasGyro) {
            gyroX = gx; gyroY = gy; gyroZ = gz
            wristSpin = sqrt(gx * gx + gy * gy + gz * gz)
        }
        gyroAligned = gyroOk
        accelListener?.process(ax, ay, az, t * 1_000_000L)
    }

    /** Recording paused (the athlete paused, or the watch was off the wrist / locked). */
    @VisibleForTesting
    internal fun replayNotCounting() { accelListener?.notCounting() }

    @VisibleForTesting
    internal fun replayHeartRate(t: Long, bpm: Int) {
        replayNowMs = max(replayNowMs, t)
        replayHr?.onReading(SensorManager.SENSOR_STATUS_ACCURACY_HIGH, bpm, t)
    }

    @VisibleForTesting
    internal fun replayBarometer(t: Long, hPa: Float) {
        replayNowMs = max(replayNowMs, t)
        replayBaro?.onBarometer(t, hPa)
    }

    /** Jumps still waiting for the heart rate (neither counted nor rejected yet). */
    @VisibleForTesting
    internal val pendingJumpCount: Int get() = pendingJumps.size

    /** Jumps fully verified so far (the live [jumps] also shows ones still being verified). */
    @VisibleForTesting
    internal val confirmedJumpCount: Int get() = confirmedJumps

    /** Reps of established sets (the live [reps] also shows ones held until the set is). */
    @VisibleForTesting
    internal val confirmedRepCount: Int get() = confirmedReps

    /**
     * Raw-data recorder for accuracy testing (debug builds only, see DiagnosticRecorder);
     * null = off. Set by the activity.
     */
    var diagnostics: DiagnosticRecorder? = null
    /** Latest accelerometer sample time (sensor ms), for stamping diagnostic events */
    private var lastSensorMs = 0L
    private var drillName: String? = null

    /** Logs a detector decision, and records it with the raw data when recording. */
    private fun note(kind: String, msg: String) {
        Log.d(TAG, msg)
        diagnostics?.event(lastSensorMs, kind, msg)
        onNote?.invoke(kind, msg)
    }

    // Accelerometer samples are processed with the gyroscope reading of the same moment
    // (both sensors are batched and delivered separately, see SensorAligner)
    private var accelListener: AccelListener? = null
    private var gyroAligned = false
    private val aligner = SensorAligner { ax, ay, az, tNs, gx, gy, gz, ok ->
        if (hasGyro) {
            gyroX = gx; gyroY = gy; gyroZ = gz
            wristSpin = sqrt(gx * gx + gy * gy + gz * gz)
        }
        gyroAligned = ok
        accelListener?.process(ax, ay, az, tNs)
    }
    // Latest wrist rotation speed (rad/s) from the gyroscope; 0 without one
    @Volatile private var wristSpin = 0f
    // Latest rotation speed around each watch axis (rad/s); x = around the forearm
    @Volatile private var gyroX = 0f
    @Volatile private var gyroY = 0f
    @Volatile private var gyroZ = 0f
    private var hasGyro = false
    /**
     * Repetitions shown live in rep-counting drills (on the watch, and sent to the phone): every
     * rep the moment it's done, including the first ones of a set held until the set shows its
     * rhythm (REP_STREAK_TO_COUNT). If the set breaks before that, they're taken back out.
     * Compose state.
     */
    var reps by mutableIntStateOf(0); private set
    /** Reps of established sets */
    private var confirmedReps = 0
    /** Reps seen but not confirmed yet (the set hasn't shown its rhythm; -1 = it has) */
    private var heldReps = 0

    /** Updates the live [reps]: confirmed + held in a set not established yet. */
    private fun refreshReps() {
        reps = confirmedReps + max(0, heldReps)
    }
    var playerLoad = 0f; private set
    /** Explosive starts detected from the accelerometer this session */
    var accelBursts = 0; private set
    /** Live wrist tilt (degrees): pitch = forearm up/down from level, roll = turn around the forearm */
    var pitchDeg = 0f; private set
    var rollDeg = 0f; private set
    /** Current wrist orientation, and seconds spent in each (while counting) this session */
    var orientation = Orientation.SIDE; private set
    val orientationSecs = FloatArray(Orientation.entries.size)
    var isMoving by mutableStateOf(false); private set
    var onBody by mutableStateOf(true); private set
    var profile by mutableStateOf(SensorProfile.GAME); private set
    /** Sensors actually running for the current profile, for display. */
    var activeSensors by mutableStateOf<List<String>>(emptyList()); private set

    /** Counting stops while paused; HR and wrist-contact keep updating. */
    var paused = false

    /**
     * The watch was taken off the wrist during the session, so it can't be sure its wearer
     * is still the athlete. Nothing counts until the athlete verifies again on their phone.
     * (Identity checks don't lock: the watch keeps counting while the athlete confirms.)
     */
    var wearerLocked by mutableStateOf(false); private set
    /** Why it locked ("off_wrist"); sent to the phone in telemetry. */
    var lockWhy by mutableStateOf<String?>(null); private set

    /**
     * Times the watch came off the wrist only briefly (too short to lock) this session.
     * The phone asks for an identity check at the next rest when this goes up.
     */
    var wristBlips = 0; private set

    fun noteWristBlip() { wristBlips += 1 }

    /**
     * Times the heart rate changed in a way one person's heart doesn't (a sudden jump, or a
     * signal gap after which it came back clearly different). The phone asks for an
     * identity check when this goes up.
     */
    var hrAnomalies = 0; private set
    // Reliable readings of the last ~20 s, and the last moment the sensor had a lock
    private val hrSamples = ArrayDeque<Pair<Long, Int>>()
    private var hrLastReliableAt = 0L
    private var hrGapFrom = 0L
    private var hrBeforeGap = 0
    private var hrLastAnomalyAt = 0L

    /**
     * Whether wrist contact comes from the watch's dedicated off-body sensor. Without it
     * the watch only has heart-rate contact, which can drop out for a few seconds during
     * hard sprints on a loose strap, so the lock waits longer before trusting it.
     */
    val hasOffBodySensor: Boolean get() = offBodySensorSaysOn != null

    fun lockWearer(why: String) {
        wearerLocked = true
        lockWhy = why
        isMoving = false
    }

    fun unlockWearer() {
        wearerLocked = false
        lockWhy = null
    }

    private val listeners = mutableListOf<SensorEventListener>()

    // (time, step length) for each recent step, for cadence and live speed
    private val recentSteps = ArrayDeque<Pair<Long, Float>>()
    private var windowStartedAt = 0L

    private var offBodySensorSaysOn: Boolean? = null
    private var hrNoContact = false

    // Totals at the start of the current drill, and that drill's heart-rate readings,
    // for the per-drill record kept on the watch while the phone is out of range
    private var drillStartSteps = 0
    private var drillStartMeters = 0f
    private var drillStartJumps = 0
    private var drillStartReps = 0
    private var drillStartLoad = 0f
    private var drillStartAccel = 0
    private var drillHrSum = 0L
    private var drillHrCount = 0
    private var drillHrMax = 0

    /** Starts a new drill segment from the current totals. */
    fun markDrillStart() {
        // Jumps held in the last drill's unfinished series / run end with it (they never
        // became a set); then this drill's count starts from what's left
        loneJumpHeld = false
        plyoRunHeld = 0
        refreshJumps()
        heldReps = 0
        refreshReps()
        drillSeq += 1
        drillStartSteps = steps
        drillStartMeters = meters
        drillStartJumps = jumps
        drillStartReps = reps
        drillStartLoad = playerLoad
        drillStartAccel = accelBursts
        drillHrSum = 0L
        drillHrCount = 0
        drillHrMax = 0
        drillJumpCandidates = 0
        drillStartHr = heartRate
        loneJumpHeld = false
        lastJumpCandidateAt = 0L
        plyoRunHeld = 0
        plyoRunContacts.clear()
        plyoRunStartHr = 0
        plyoRunLandingAt = 0L
        plyoQueue.clear()
        downJump = null
        contactSumMs = 0L
        contactCount = 0
        groundContactMs = 0
        repStyleVersion += 1
        note("drill_start", "Drill start '$drillName' (jumps $jumps, reps $reps so far)")
    }

    /** True when the heart rate shows the athlete is really working. */
    private fun hrSaysActive(): Boolean {
        val hr = heartRate
        if (hr <= 0) return false
        return hr >= JUMP_ACTIVE_HR || (drillStartHr > 0 && hr >= drillStartHr + JUMP_HR_RISE)
    }

    // A lone jump waiting for a second one (see JUMP_STREAK_GAP_MS)
    private var loneJumpHeld = false
    private var lastJumpCandidateAt = 0L

    /**
     * A movement that looks like a real jump. Jumps come in a series: the first one is held
     * until a second follows within [JUMP_STREAK_GAP_MS] (a single arm movement then never
     * counts), then each one counts, or waits until the heart rate agrees.
     */
    private fun onJumpDetected(now: Long, info: JumpDetector.JumpInfo?) {
        if (profile.plyometric) {
            if (info != null) plyoQueue.addLast(info)
            drainPlyo(info?.impactAt ?: 0L)
            return
        }
        val inSeries = lastJumpCandidateAt > 0L && now - lastJumpCandidateAt <= JUMP_STREAK_GAP_MS
        lastJumpCandidateAt = now
        if (!inSeries) {
            if (loneJumpHeld) {
                jumpsRejected += 1
                note("jump_reject", "Lone jump not followed by another within ${JUMP_STREAK_GAP_MS}ms: not counted")
            }
            loneJumpHeld = true
            note("jump_held", "Jump held until a second one follows")
            return
        }
        if (loneJumpHeld) {
            loneJumpHeld = false
            countJump(now)
        }
        countJump(now)
    }

    /** Box / depth jumps need the barometer, so plyometric jumps wait for it, in order. */
    private fun needsBarometer(): Boolean {
        val styles = effectivePlyoStyles()
        return hasBarometer && (PlyoStyle.BOX in styles || PlyoStyle.DEPTH in styles)
    }

    /**
     * Judges the waiting plyometric jumps whose barometer readings are in.
     * [sensorNow] = latest accelerometer / barometer event time (ms).
     */
    private fun drainPlyo(sensorNow: Long) {
        while (plyoQueue.isNotEmpty()) {
            val j = plyoQueue.first()
            var dh: Float? = null
            if (needsBarometer()) {
                val baroAt = baroSamples.lastOrNull()?.first ?: 0L
                val ready = baroAt >= j.impactAt + BARO_AFTER_TO_MS
                if (!ready && sensorNow < j.impactAt + BARO_TIMEOUT_MS) return
                dh = heightChange(j.beforeAt, j.impactAt)
            }
            plyoQueue.removeFirst()
            onPlyoJump(j, dh)
        }
    }

    /**
     * Height gained (m, + = higher) from standing before [beforeAt] to standing after the
     * landing at [impactAt], from the barometer; null without enough readings.
     */
    private fun heightChange(beforeAt: Long, impactAt: Long): Float? {
        val before = baroMedian(beforeAt - BARO_BEFORE_FROM_MS, beforeAt - BARO_BEFORE_TO_MS) ?: return null
        val after = baroMedian(impactAt + BARO_AFTER_FROM_MS, impactAt + BARO_AFTER_TO_MS) ?: return null
        // Air density from the pressure (15 °C): ~12 Pa per metre at sea level
        val rho = before * 100f / (287.05f * 288.15f)
        return (before - after) * 100f / (rho * GRAVITY)
    }

    private fun baroMedian(from: Long, to: Long): Float? {
        val values = baroSamples.filter { it.first in from..to }.map { it.second }.sorted()
        return if (values.size >= BARO_MIN_SAMPLES) values[values.size / 2] else null
    }

    private enum class PlyoKind { GROUND, BOX, DEPTH }

    /**
     * A plyometric jump (passed JumpDetector's plyometric checks), with the barometer's height
     * change [dh] when box / depth drills need it. Verified for the drill's styles, then counted
     * only as part of a run (see PLYO_RUN_TO_COUNT), each run once the heart rate responds to it.
     */
    private fun onPlyoJump(j: JumpDetector.JumpInfo, dh: Float?) {
        val styles = effectivePlyoStyles()
        val groundStyles = PlyoStyle.REBOUND in styles || PlyoStyle.RESET in styles
        val rebound = j.contactMs in JumpDetector.PLYO_MIN_CONTACT_MS..JumpDetector.PLYO_REBOUND_MAX_CONTACT_MS
        val down = downJump
        downJump = null
        fun cm(h: Float?) = h?.let { "${(it * 100).toInt()} cm" } ?: "no barometer reading"

        var why: String? = null
        val kind: PlyoKind? = when {
            // Depth jump: out of the landing of a drop off a box (no push, or a little hop off)
            j.afterDrop || (down != null && rebound && j.takeoffAt - down.impactAt == j.contactMs) -> {
                val drop = if (j.afterDrop) dh else down?.let { heightChange(it.beforeAt, j.impactAt) }
                if (drop != null && drop <= -BOX_MIN_HEIGHT_M) PlyoKind.DEPTH
                else { why = "depth jump without coming down from a box (${cm(drop)})"; null }
            }
            // Soft landing: only allowed onto a box
            j.softLanding ->
                if (dh != null && dh >= BOX_MIN_HEIGHT_M) PlyoKind.BOX
                else { why = "soft landing, not onto a box (${cm(dh)})"; null }
            PlyoStyle.BOX in styles && dh != null && dh >= BOX_MIN_HEIGHT_M -> PlyoKind.BOX
            // Jumped down off a box: the step-off of a depth jump, not counted itself
            PlyoStyle.DEPTH in styles && dh != null && dh <= -BOX_MIN_HEIGHT_M -> {
                downJump = j
                note("plyo_drop", "Plyo: down off a box (${cm(dh)}), waiting for the jump out of it")
                return
            }
            !groundStyles -> { why = "no box: height changed ${cm(dh)}"; null }
            // Tuck jumps: the light part of the flight undersells it, so the whole time in the
            // air counts (the dip before a jump never lasts that long)
            PlyoStyle.REBOUND !in styles && jumpDetector.inPlace && j.airMs < PLYO_IN_PLACE_MIN_AIR_MS ->
                { why = "low jump (${j.airMs} ms in the air): not a max-effort jump"; null }
            PlyoStyle.REBOUND !in styles && !jumpDetector.inPlace &&
                (if (jumpDetector.tuck) j.airMs else j.flightMs) < PLYO_RESET_MIN_FLIGHT_MS ->
                { why = "low jump (${if (jumpDetector.tuck) j.airMs else j.flightMs} ms in the air): not a max-effort jump"; null }
            else -> PlyoKind.GROUND
        }
        if (kind == null) {
            jumpsRejected += 1
            note("plyo_reject", "Plyo jump not counted: $why")
            return
        }

        val gap = if (plyoRunLandingAt > 0L) j.takeoffAt - plyoRunLandingAt else Long.MAX_VALUE
        val reboundLink = kind == PlyoKind.GROUND && PlyoStyle.REBOUND in styles && rebound
        // Arm-swing drills: the flight is measured loosely there (arms moving all through it),
        // so it can't tell a max-effort jump; jumps within the gap link
        val linked = reboundLink || (gap <= PLYO_RESET_MAX_GAP_MS && when (kind) {
            PlyoKind.GROUND -> PlyoStyle.RESET in styles &&
                (j.flightMs >= PLYO_RESET_MIN_FLIGHT_MS || jumpDetector.armSwing)
            else -> true
        })
        // Ground contact shown on the watch: rebounds, and the contact out of a depth drop
        val contact = if (reboundLink || kind == PlyoKind.DEPTH) j.contactMs else -1L
        plyoRunLandingAt = j.impactAt
        val now = clock()

        if (!linked) {
            // Not linked to the last jump: a new run starts with this one. Jumps held in a
            // run that never got going were lone or faked movements
            if (plyoRunHeld > 0) {
                jumpsRejected += plyoRunHeld
                note("plyo_reject", "Plyo run of $plyoRunHeld broken ($kind, contact ${j.contactMs}ms, gap ${gap}ms): not counted")
            }
            plyoRunHeld = 1
            plyoRunContacts.clear()
            plyoRunContacts += contact
            plyoRunStartHr = restingHr(now)
            note("plyo_held", "Plyo run started ($kind, resting hr $plyoRunStartHr), held until $PLYO_RUN_TO_COUNT in a row")
            return
        }
        val needHr = if (plyoRunStartHr > 0) plyoRunStartHr + PLYO_SET_HR_RISE else 0
        if (plyoRunHeld < 0) {
            // Established run: each further jump counts (or waits for the heart rate)
            if (contact >= 0) noteContact(contact)
            countJump(now, needHr, plyo = true)
            return
        }
        plyoRunHeld += 1
        plyoRunContacts += contact
        val runToCount = if (jumpDetector.inPlace) PLYO_RUN_TO_COUNT_IN_PLACE else PLYO_RUN_TO_COUNT
        if (plyoRunHeld < runToCount) note("plyo_held", "Plyo run: $plyoRunHeld held ($kind)")
        if (plyoRunHeld >= runToCount) {
            note("plyo_run", "Plyo run established ($kind): $plyoRunHeld jumps, contacts $plyoRunContacts ms")
            repeat(plyoRunHeld) { countJump(now, needHr, plyo = true) }
            plyoRunContacts.filter { it >= 0 }.forEach { noteContact(it) }
            plyoRunContacts.clear()
            plyoRunHeld = -1
        }
    }

    private fun noteContact(ms: Long) {
        contactSumMs += ms
        contactCount += 1
        groundContactMs = (contactSumMs / contactCount).toInt()
    }

    /**
     * True when the heart rate backs a jump that needs [needHr]. A plyometric run's jumps need
     * their set's rise only (see PLYO_SET_HR_RISE); other jumps need [hrSaysActive] as well
     * (and a plyo run that started without a heart-rate reading falls back to it).
     */
    private fun hrBacks(needHr: Int, plyo: Boolean): Boolean {
        val hr = heartRate
        if (hr <= 0) return false
        if (plyo && needHr > 0) return hr >= needHr
        return hrSaysActive() && hr >= needHr
    }

    /**
     * The athlete's resting level before a plyo run: the lowest heart rate over the last
     * [PLYO_HR_BASELINE_MS] (the current reading when there's no history). The reading at the
     * run's start would be wrong after an earlier run or drill that left it high.
     */
    private fun restingHr(now: Long): Int {
        val recent = hrHistory.filter { now - it.first <= PLYO_HR_BASELINE_MS }.map { it.second }
        return (recent + listOfNotNull(heartRate.takeIf { it > 0 })).minOrNull() ?: 0
    }

    private fun countJump(now: Long, needHr: Int = 0, plyo: Boolean = false) {
        drillJumpCandidates += 1
        if (!hasHrSensor || drillJumpCandidates <= FREE_JUMPS_PER_DRILL || hrBacks(needHr, plyo)) {
            confirmedJumps += 1
            refreshJumps()
            note("jump_count", "Jump counted (total $jumps, hr $heartRate)")
        } else {
            pendingJumps.addLast(PendingJump(now, needHr, drillSeq, plyo))
            note("jump_pending", "Jump waiting for the heart rate (hr $heartRate, start $drillStartHr, needs $needHr${if (plyo) " plyo" else ""})")
        }
        confirmJumps(now)
    }

    /**
     * Pending jumps are confirmed once the heart rate rises; taken back out of the live count if
     * it doesn't in time.
     */
    private fun confirmJumps(now: Long) {
        if (pendingJumps.isEmpty()) {
            refreshJumps()
            return
        }
        val before = pendingJumps.size
        pendingJumps.removeAll { hrBacks(it.needHr, it.plyo) }
        val confirmed = before - pendingJumps.size
        confirmedJumps += confirmed
        if (confirmed > 0) note("jump_count", "$confirmed waiting jump(s) confirmed by heart rate $heartRate (total ${confirmedJumps + pendingJumps.size})")
        while (pendingJumps.isNotEmpty() && now - pendingJumps.first().at > JUMP_PENDING_MAX_MS) {
            val dropped = pendingJumps.removeFirst()
            jumpsRejected += 1
            // From a drill already over: it was in this drill's starting total, so take it off there
            if (dropped.drill != drillSeq) drillStartJumps -= 1
            note("jump_reject", "Waiting jump dropped: heart rate $heartRate didn't rise within ${JUMP_PENDING_MAX_MS}ms")
        }
        refreshJumps()
    }

    /**
     * Record of the drill since [markDrillStart], in the format the phone merges
     * (see applyWatchDrillRecord in the mobile app). Short keys keep it in one BLE packet.
     * With [done], the session's final totals are included too.
     */
    fun drillRecord(
        sid: String,
        index: Int,
        name: String,
        startSecs: Int,
        endSecs: Int,
        done: Boolean,
        sessionSecs: Int
    ): JSONObject = JSONObject().apply {
        put("t", "drill")
        put("sid", sid)
        put("i", index)
        put("n", name.take(40))
        put("s", startSecs)
        put("e", endSecs)
        put("st", steps - drillStartSteps)
        put("m", Math.round((meters - drillStartMeters) * 10) / 10.0)
        put("j", max(0, jumps - drillStartJumps))
        put("r", max(0, reps - drillStartReps))
        put("l", Math.round((playerLoad - drillStartLoad) * 10) / 10.0)
        put("ac", accelBursts - drillStartAccel)
        put("ha", if (drillHrCount > 0) Math.round(drillHrSum.toDouble() / drillHrCount).toInt() else 0)
        put("hm", drillHrMax)
        put("done", done)
        if (done) {
            put("tot", JSONObject().apply {
                put("st", steps)
                put("m", Math.round(meters * 10) / 10.0)
                put("j", jumps)
                put("r", reps)
                put("l", Math.round(playerLoad * 10) / 10.0)
                put("ac", accelBursts)
                put("secs", sessionSecs)
            })
        }
    }

    fun reset() {
        steps = 0
        meters = 0f
        jumps = 0
        confirmedJumps = 0
        jumpsRejected = 0
        pendingJumps.clear()
        hrHistory.clear()
        drillJumpCandidates = 0
        drillStartHr = 0
        jumpDetector.reset()
        groundContactMs = 0
        reps = 0
        confirmedReps = 0
        heldReps = 0
        heartRate = 0
        playerLoad = 0f
        accelBursts = 0
        orientationSecs.fill(0f)
        orientation = Orientation.SIDE
        isMoving = false
        onBody = true
        offBodySensorSaysOn = null
        hrNoContact = false
        paused = false
        unlockWearer()
        wristBlips = 0
        hrAnomalies = 0
        hrSamples.clear()
        hrLastReliableAt = 0L
        hrGapFrom = 0L
        hrBeforeGap = 0
        hrLastAnomalyAt = 0L
        recentSteps.clear()
        markDrillStart()
        windowStartedAt = clock()
    }

    /**
     * Rejoining a session the phone kept running (call right after [reset]): totals start
     * from the phone's numbers, so the phone's live totals don't fall back to zero.
     */
    fun carryOver(steps: Int, meters: Float, jumps: Int, reps: Int, load: Float, accelBursts: Int) {
        this.steps = steps
        this.meters = meters
        this.confirmedJumps = jumps
        this.jumps = jumps
        this.confirmedReps = reps
        this.reps = reps
        this.playerLoad = load
        this.accelBursts = accelBursts
        markDrillStart()
    }

    /** (Re)registers the sensors for [newProfile]. Totals carry over. */
    fun start(newProfile: SensorProfile) {
        stop()
        profile = newProfile
        hasBarometer = false
        baroSamples.clear()
        applyPlyoStyles()
        val sm = sensorManager ?: return
        val running = mutableListOf<String>()

        val stepCounter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        val stepDetector = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        val hardwareSteps = newProfile.countSteps && (stepCounter != null || stepDetector != null)
        val accelSteps = newProfile.accelSteps || (newProfile.countSteps && !hardwareSteps)

        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            val accel = AccelListener(accelSteps, newProfile.detectJumps, newProfile.countReps)
            accelListener = accel
            register(sm, accel, it, ACCEL_PERIOD_US, ACCEL_MAX_LATENCY_US)
            running += "Load"
            if (accelSteps) running += if (newProfile.accelSteps) "Slide steps" else "Steps"
            if (newProfile.detectJumps) running += if (newProfile.plyometric) "Rebounds" else "Jumps"
            if (newProfile.plyometric) running += "Contact"
            if (newProfile.countReps) running += "Reps"
        }

        // Wrist rotation: a jump's flight doesn't whip the arm around like a hand swing does,
        // and a push-up doesn't twist the forearm like a hand turned in the air does
        wristSpin = 0f; gyroX = 0f; gyroY = 0f; gyroZ = 0f
        hasGyro = false
        if (newProfile.detectJumps || newProfile.countReps) {
            sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
                register(sm, GyroListener(), it, GYRO_PERIOD_US, ACCEL_MAX_LATENCY_US)
                hasGyro = true
                running += "Gyro"
            }
        }
        // Sensor callbacks run on this (main) thread, so none arrive before this reset
        aligner.reset(gyroEnabled = hasGyro)

        // Plyometrics: the barometer confirms box jumps (landed higher) and depth jumps (came
        // down from a box)
        if (newProfile.plyometric) {
            sm.getDefaultSensor(Sensor.TYPE_PRESSURE)?.let {
                register(sm, BarometerListener(), it, BARO_PERIOD_US, ACCEL_MAX_LATENCY_US)
                hasBarometer = true
                running += "Barometer"
            }
            applyPlyoStyles()
        }

        if (hardwareSteps) {
            register(sm, StepListener(), stepCounter ?: stepDetector!!, SensorManager.SENSOR_DELAY_UI)
            running += "Steps"
        }

        hasHrSensor = false
        sm.getDefaultSensor(Sensor.TYPE_HEART_RATE)?.let {
            hasHrSensor = true
            register(sm, HeartRateListener(), it, SensorManager.SENSOR_DELAY_NORMAL)
            running += "HR"
        }

        (sm.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT, true)
            ?: sm.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT))?.let {
            register(sm, OffBodyListener(), it, SensorManager.SENSOR_DELAY_NORMAL)
        }

        activeSensors = running
        Log.d(TAG, "Profile ${newProfile.key}: sensors $running")

        // Jump, plyometric and strength drills: record raw data for accuracy testing (debug)
        if (newProfile.detectJumps || newProfile.countReps) {
            diagnostics?.begin(
                newProfile.key,
                mapOf(
                    "profile" to newProfile.key,
                    "drill" to drillName,
                    "repStyle" to repStyle,
                    "plyoStyles" to effectivePlyoStyles().joinToString("|"),
                    "sensors" to running.joinToString("|"),
                    "gyro" to hasGyro,
                    "barometer" to hasBarometer,
                    "hrSensor" to hasHrSensor,
                    "accelPeriodUs" to ACCEL_PERIOD_US,
                    "gyroPeriodUs" to GYRO_PERIOD_US,
                    "maxLatencyUs" to ACCEL_MAX_LATENCY_US,
                ),
            )
        }
    }

    fun stop() {
        listeners.forEach { sensorManager?.unregisterListener(it) }
        listeners.clear()
        accelListener = null
        diagnostics?.end()
    }

    fun cadenceSpm(now: Long = clock()): Float {
        prune(now)
        val windowMs = (now - max(windowStartedAt, now - WINDOW_MS)).coerceAtLeast(3_000L)
        return recentSteps.size * 60_000f / windowMs
    }

    /** Step-based speed over the last [BURST_WINDOW_MS]: shows sprints and starts quickly. */
    fun burstSpeedKmh(now: Long = clock()): Float {
        prune(now)
        val windowMs = min(BURST_WINDOW_MS, (now - windowStartedAt).coerceAtLeast(1_000L))
        val meters = recentSteps.filter { now - it.first <= BURST_WINDOW_MS }.sumOf { it.second.toDouble() }
        return meters.toFloat() / (windowMs / 1000f) * 3.6f
    }

    fun speedKmh(now: Long = clock()): Float {
        prune(now)
        val windowMs = (now - max(windowStartedAt, now - WINDOW_MS)).coerceAtLeast(3_000L)
        return recentSteps.sumOf { it.second.toDouble() }.toFloat() / (windowMs / 1000f) * 3.6f
    }

    /**
     * Live packet for the phone; [completed] tells it the watch ended the session, and
     * [why] how: "completed" (plan finished) or "ended_early" (End pressed on the watch).
     */
    fun telemetryJson(
        secs: Int,
        isPaused: Boolean,
        drill: Int,
        sid: String?,
        completed: Boolean = false,
        why: String? = null,
        /** Time spent in the current drill (rests and pauses excluded); -1 = not known */
        drillSecs: Int = -1
    ): String = String.format(
        Locale.US,
        "{\"sid\":%s,\"secs\":%d,\"dsecs\":$drillSecs,\"steps\":%d,\"meters\":%.1f,\"jumps\":%d,\"reps\":%d,\"bpm\":%d,\"moving\":%b,\"paused\":%b," +
            "\"drill\":%d,\"load\":%.1f,\"spd\":%.1f,\"cad\":%d,\"prof\":\"%s\",\"onBody\":%b,\"completed\":%b,\"why\":%s," +
            "\"lock\":%b,\"lockWhy\":%s,\"blip\":%d,\"hrj\":%d,\"jrej\":%d," +
            "\"acc\":%d,\"bspd\":%.1f,\"pit\":%d,\"rol\":%d,\"ori\":[%d,%d,%d,%d]}",
        sid?.let { JSONObject.quote(it) } ?: "null", secs, steps, meters, jumps, reps, heartRate, isMoving, isPaused,
        drill, playerLoad, speedKmh(), cadenceSpm().toInt(), profile.key, onBody, completed,
        why?.let { JSONObject.quote(it) } ?: "null",
        wearerLocked, lockWhy?.let { JSONObject.quote(it) } ?: "null", wristBlips, hrAnomalies, jumpsRejected,
        accelBursts, burstSpeedKmh(), pitchDeg.toInt(), rollDeg.toInt(),
        orientationSecs[0].toInt(), orientationSecs[1].toInt(), orientationSecs[2].toInt(), orientationSecs[3].toInt()
    )

    private fun register(
        sm: SensorManager,
        listener: SensorEventListener,
        sensor: Sensor,
        period: Int,
        maxLatencyUs: Int = 0
    ) {
        if (sm.registerListener(listener, sensor, period, maxLatencyUs)) listeners += listener
        else Log.w(TAG, "Could not register ${sensor.name}")
    }

    /**
     * Counting stops when paused, locked or off the wrist. Watches without an off-body sensor
     * only know contact from the heart-rate sensor, which drops out for a moment at hard
     * landings: counting keeps going through such short dropouts, or no jump would count.
     */
    private fun counting(): Boolean {
        if (paused || wearerLocked) return false
        if (onBody) return true
        return !hasOffBodySensor && clock() - offBodySince < CONTACT_DROPOUT_GRACE_MS
    }

    private fun addSteps(count: Int, now: Long) {
        if (count <= 0) return
        val length = stepLengthMeters(cadenceSpm(now))
        repeat(count.coerceAtMost(50)) { recentSteps.addLast(now to length) }
        steps += count
        meters += count * length
    }

    /** Step length grows with cadence: ~0.7 m walking, up to ~1.3 m sprinting. */
    private fun stepLengthMeters(cadence: Float): Float {
        if (profile.accelSteps) return LATERAL_STEP_M
        if (cadence < 60f) return 0.7f
        return (0.7f + (cadence - 120f) * (0.6f / 70f)).coerceIn(0.6f, 1.3f)
    }

    private fun prune(now: Long) {
        while (recentSteps.isNotEmpty() && now - recentSteps.first().first > WINDOW_MS) {
            recentSteps.removeFirst()
        }
    }

    private fun updateOnBody() {
        val was = onBody
        onBody = offBodySensorSaysOn ?: !hrNoContact
        if (was && !onBody) offBodySince = clock()
        if (!onBody) isMoving = false
    }

    /** When the wrist contact was last lost (see [counting]) */
    private var offBodySince = 0L

    // Low-passed gravity for the wrist orientation
    private var gx = 0f
    private var gy = 0f
    private var gz = 0f
    private var gravityReady = false

    /** Low-passes gravity and updates the live tilt and the orientation class. */
    private fun updateOrientation(x: Float, y: Float, z: Float, dt: Float) {
        if (!gravityReady) {
            gx = x; gy = y; gz = z; gravityReady = true
        } else if (dt > 0f) {
            val a = dt / (GRAVITY_SMOOTH_S + dt)
            gx += a * (x - gx); gy += a * (y - gy); gz += a * (z - gz)
        }
        val g = sqrt(gx * gx + gy * gy + gz * gz)
        if (g < 1f) return
        pitchDeg = Math.toDegrees(atan2(gx.toDouble(), sqrt((gy * gy + gz * gz).toDouble()))).toFloat()
        rollDeg = Math.toDegrees(atan2(gy.toDouble(), gz.toDouble())).toFloat()
        val forearmFromLevel = Math.toDegrees(asin((abs(gx) / g).coerceAtMost(1f).toDouble()))
        orientation = when {
            forearmFromLevel >= ORI_VERTICAL_DEG -> Orientation.VERTICAL
            gz / g >= ORI_FACE_G -> Orientation.FACE_UP
            gz / g <= -ORI_FACE_G -> Orientation.FACE_DOWN
            else -> Orientation.SIDE
        }
    }

    private inner class AccelListener(
        private val countSteps: Boolean,
        private val detectJumps: Boolean,
        private val countReps: Boolean,
    ) : SensorEventListener {
        private var hasPrev = false
        private var px = 0f
        private var py = 0f
        private var pz = 0f
        private var lastMovementAt = 0L
        private var lastStepAt = 0L
        private var lastSampleAt = 0L
        // Acceleration bursts
        private var accSmooth = 0f
        private var accCalmAt = 0L
        private var accArmed = false
        private var lastBurstAt = 0L
        private var aboveStepThreshold = false

        // Rep counting state, per axis: smoothed reading, resting level, swing variance
        private val sample = FloatArray(3)
        private val smooth = FloatArray(3)
        private val rest = FloatArray(3)
        private val swingVar = FloatArray(3)
        private var repPrimed = false
        private var repSampleAt = 0L
        private var repAxis = 0
        private var repArmed = false
        private var repArmedAt = 0L
        private var repLow = 0f
        // Push-ups: highest forearm tilt since the last rep (NaN = none yet), see detectRep
        private var tiltHigh = Float.NaN
        private var repImpact = 0f
        // Push-up checks over the rep: forearm posture, twist, rotation, wrist movement
        private var repForearmSum = 0f
        private var repSamples = 0
        private var repTwist = 0f
        private var repTurn = 0f
        private var repSpinPeak = 0f
        private var repMovePeak = 0f
        private var moveSmooth = 0f
        // Sit-ups: most gravity into the watch face seen lately (lying back), fading slowly
        // (~0.05 g/s) so it covers the whole rep whichever end of it lying back is
        private var repFacePeak = 0f
        private var lastRepAt = 0L
        // The last rep's size (reps held until the set shows its rhythm: tracker's heldReps)
        private var lastRepSize = 0f
        private var seenStyleVersion = -1

        override fun onSensorChanged(event: SensorEvent) {
            // Handed back to process() once the gyroscope has caught up (SensorAligner)
            aligner.pushAccel(event.values[0], event.values[1], event.values[2], event.timestamp)
        }

        /** One accelerometer sample (m/s², sensor time ns); gyroX/Y/Z are set for its moment. */
        fun process(x: Float, y: Float, z: Float, timestampNs: Long) {
            val now = timestampNs / 1_000_000L
            lastSensorMs = now
            val magnitude = sqrt(x * x + y * y + z * z)
            val dynamicAcc = abs(magnitude - GRAVITY)

            if (dynamicAcc > MOVING_THRESHOLD && onBody && !wearerLocked) {
                lastMovementAt = now
                isMoving = true
            } else if (now - lastMovementAt > STILL_AFTER_MS) {
                isMoving = false
            }

            val dt = if (lastSampleAt == 0L) 0f else ((now - lastSampleAt) / 1000f).coerceIn(0f, 0.2f)
            lastSampleAt = now
            updateOrientation(x, y, z, dt)

            if (!counting()) {
                notCounting()
                return
            }

            diagnostics?.sample(now, x, y, z, gyroX, gyroY, gyroZ, gyroAligned)

            // Wrist orientation: time spent in each class
            orientationSecs[orientation.ordinal] += dt

            // Acceleration bursts: calm -> vigorous within ACC_RISE_MS
            if (dt > 0f) accSmooth += (dt / (ACC_SMOOTH_S + dt)) * (dynamicAcc - accSmooth)
            if (accSmooth < ACC_CALM) {
                accCalmAt = now
                accArmed = true
            } else if (accArmed && accSmooth > ACC_BURST && now - accCalmAt <= ACC_RISE_MS &&
                now - lastBurstAt >= ACC_MIN_GAP_MS
            ) {
                accelBursts += 1
                lastBurstAt = now
                accArmed = false
            }

            // PlayerLoad: sum of acceleration change across all three axes (g), / 100
            if (hasPrev) {
                val dx = (x - px) / GRAVITY
                val dy = (y - py) / GRAVITY
                val dz = (z - pz) / GRAVITY
                playerLoad += sqrt(dx * dx + dy * dy + dz * dz) / 100f
            }
            px = x; py = y; pz = z; hasPrev = true

            if (countSteps && isMoving) {
                // Count once per peak: rising edge over the threshold
                if (dynamicAcc > ACCEL_STEP_THRESHOLD && !aboveStepThreshold && now - lastStepAt > ACCEL_STEP_MIN_GAP_MS) {
                    lastStepAt = now
                    addSteps(1, clock())
                }
                aboveStepThreshold = dynamicAcc > ACCEL_STEP_THRESHOLD
            }

            if (detectJumps) {
                if (jumpDetector.onSample(magnitude, now, wristSpin)) {
                    onJumpDetected(clock(), jumpDetector.lastJump)
                } else if (jumpDetector.swingRejected) {
                    // Jump-shaped but faked (arm swung up and down): shown to the coach
                    jumpsRejected += 1
                }
                if (plyoQueue.isNotEmpty()) drainPlyo(now)
                // A jump held in a series / run shows at once (no-op when nothing changed)
                refreshJumps()
            }
            if (countReps) {
                detectRep(x, y, z, magnitude, now)
                // A rep held until the set shows its rhythm shows at once (no-op when unchanged)
                refreshReps()
            }
        }

        /** Paused, locked or off the wrist: movements in progress are forgotten. */
        fun notCounting() {
            hasPrev = false
            jumpDetector.reset()
            repPrimed = false
            accArmed = false
        }

        private fun detectRep(x: Float, y: Float, z: Float, magnitude: Float, now: Long) {
            sample[0] = x; sample[1] = y; sample[2] = z
            val style = repStyle
            if (!repPrimed || seenStyleVersion != repStyleVersion) {
                // Start from the current wrist orientation, with no swing history
                for (i in 0..2) { smooth[i] = sample[i]; rest[i] = sample[i]; swingVar[i] = 0f }
                repPrimed = true
                repArmed = false
                tiltHigh = Float.NaN
                repSampleAt = now
                heldReps = 0
                lastRepSize = 0f
                lastRepAt = 0L
                seenStyleVersion = repStyleVersion
                return
            }
            val dt = ((now - repSampleAt) / 1000f).coerceIn(0.001f, 0.2f)
            repSampleAt = now
            val smoothGain = dt / (REP_SMOOTH_S + dt)
            val restGain = dt / (REP_BASELINE_S + dt)

            var busiest = 0
            for (i in 0..2) {
                smooth[i] += smoothGain * (sample[i] - smooth[i])
                rest[i] += restGain * (smooth[i] - rest[i])
                val swing = smooth[i] - rest[i]
                swingVar[i] += restGain * (swing * swing - swingVar[i])
                if (swingVar[i] > swingVar[busiest]) busiest = i
            }
            // Push-ups don't follow an axis: one rep = the forearm's tilt (gravity across the
            // forearm, watch y-z plane) dips by PUSH_UP_CYCLE and comes back by as much,
            // whatever level it rests at. Following the "busiest" axis instead locks onto x
            // (getting into position puts 1 g on it), and the push-up's quick dip-and-return
            // never crosses above a resting level, so recorded sets counted ~nothing.
            val pushUp = style == RepStyle.PUSH_UP
            val tilt = if (pushUp) hypot(smooth[1], smooth[2]) else 0f

            // Follow the axis the exercise moves most; switch only when clearly ahead
            if (!pushUp && busiest != repAxis && swingVar[busiest] > swingVar[repAxis] * 1.5f) {
                repAxis = busiest
                repArmed = false
            }

            // The set stopped (no rep for too long): reps still held were lone movements
            if (lastRepAt > 0L && now - lastRepAt > style.maxRepMs) {
                heldReps = 0
                lastRepSize = 0f
                lastRepAt = 0L
            }

            // One rep = the swing dips clearly below rest, then rises clearly above it
            val swing = smooth[repAxis] - rest[repAxis]
            val threshold = max(style.minSwing, 0.5f * sqrt(swingVar[repAxis]))
            // Wrist acceleration besides gravity, lightly smoothed (sensor noise ~0.05 g)
            moveSmooth += (dt / (0.05f + dt)) * (abs(magnitude - GRAVITY) - moveSmooth)
            repFacePeak = max(abs(smooth[2]) / GRAVITY, repFacePeak - 0.05f * dt)
            if (repArmed) {
                if (pushUp) { if (tilt < repLow) repLow = tilt } else if (swing < repLow) repLow = swing
                if (magnitude > repImpact) repImpact = magnitude
                // Forearm = watch x axis (see PUSH_UP_MIN_FOREARM_G)
                repForearmSum += abs(smooth[0]) / GRAVITY
                repSamples += 1
                repTwist += abs(gyroX) * dt
                repTurn += sqrt(gyroX * gyroX + gyroY * gyroY + gyroZ * gyroZ) * dt
                repSpinPeak = max(repSpinPeak, wristSpin)
                repMovePeak = max(repMovePeak, moveSmooth)
                if (now - repArmedAt > style.maxRepMs) {
                    repArmed = false   // too slow: not a rep
                    tiltHigh = tilt
                }
            }
            if (pushUp && !repArmed) tiltHigh = if (tiltHigh.isNaN()) tilt else max(tiltHigh, tilt)
            val repStarts = if (pushUp) tilt < tiltHigh - PUSH_UP_CYCLE else swing < -threshold
            val repEnds = if (pushUp) tilt > repLow + PUSH_UP_CYCLE else swing > threshold
            if (repStarts && !repArmed) {
                repArmed = true
                repArmedAt = now
                repLow = if (pushUp) tilt else swing
                repImpact = magnitude
                repForearmSum = abs(smooth[0]) / GRAVITY
                repSamples = 1
                repTwist = 0f
                repTurn = 0f
                repSpinPeak = wristSpin
                repMovePeak = moveSmooth
            } else if (repArmed && repEnds) {
                repArmed = false
                val size = if (pushUp) tiltHigh - repLow else swing - repLow
                if (pushUp) tiltHigh = tilt
                onRepCandidate(style, now, size)
            }
        }

        /** A rep-shaped movement: counted only once it's part of a regular set. */
        private fun onRepCandidate(style: RepStyle, now: Long, size: Float) {
            val why = when {
                // Faster than anyone does this exercise: a shake, not a rep
                lastRepAt > 0L && now - lastRepAt < style.minRepMs -> "too fast ${now - lastRepAt}ms"
                // (Push-ups time only the dip, ~0.2-0.6 s: their pace is checked between reps)
                style != RepStyle.PUSH_UP && now - repArmedAt < style.minRepMs / 3 -> "jerk ${now - repArmedAt}ms"
                // Jumping jacks / burpees without the feet landing: only the arms moved
                style.needsImpact && repImpact < REP_IMPACT -> "no landing ${"%.1f".format(repImpact / GRAVITY)}g"
                style == RepStyle.PUSH_UP -> pushUpProblem()
                style == RepStyle.SIT_UP -> sitUpProblem(size)
                else -> null
            }
            if (why != null) {
                note("rep_reject", "Rep not counted ($style): $why")
                // A faked movement breaks the set: the next reps must show the rhythm again
                if (heldReps > 0) heldReps = 0
                return
            }
            // Much bigger or smaller than the last one: a different movement, start over
            if (lastRepSize > 0f && (size > lastRepSize * REP_MAX_SIZE_RATIO || size * REP_MAX_SIZE_RATIO < lastRepSize)) {
                note("rep_reset", "Rep size ${"%.1f".format(size)} vs ${"%.1f".format(lastRepSize)}: new set (${heldReps.coerceAtLeast(0)} held not counted)")
                heldReps = 0
            }
            lastRepSize = size
            lastRepAt = now
            if (heldReps < 0) {
                // The set's rhythm is established: each further rep counts right away
                confirmedReps += 1
                note("rep_count", "Rep counted ($style, size ${"%.1f".format(size)}, total $confirmedReps)")
                return
            }
            heldReps += 1
            if (heldReps >= REP_STREAK_TO_COUNT) {
                confirmedReps += heldReps
                note("rep_count", "Set established ($style): $heldReps reps counted (total $confirmedReps)")
                heldReps = -1
            } else {
                note("rep_held", "Rep held ($style, size ${"%.1f".format(size)}): $heldReps of $REP_STREAK_TO_COUNT")
            }
        }

        /** Why this doesn't look like a sit-up (torso lifting from lying back), or null if it does. */
        private fun sitUpProblem(size: Float): String? = when {
            size < SIT_UP_MIN_SIZE ->
                "tilt only ${"%.1f".format(size)} m/s² (torso didn't lift)"
            repFacePeak < SIT_UP_MIN_LYING_G ->
                "never lay back (${"%.2f".format(repFacePeak)} g into the face)"
            repForearmSum / max(1, repSamples) > SIT_UP_MAX_FOREARM_G ->
                "forearm not across the chest (${"%.2f".format(repForearmSum / max(1, repSamples))} g): hand raised"
            repMovePeak > SIT_UP_MAX_MOVE ->
                "wrist moved ${"%.1f".format(repMovePeak)} m/s² (arm swung, not the torso)"
            !hasGyro -> null
            repTurn < SIT_UP_MIN_TURN ->
                "turned only ${"%.2f".format(repTurn)} rad"
            repTwist / repTurn < SIT_UP_MIN_AXIS_SHARE ->
                "turned the wrong way (${"%.0f".format(100 * repTwist / repTurn)}% with the torso)"
            repSpinPeak > SIT_UP_MAX_SPIN ->
                "spun ${"%.1f".format(repSpinPeak)} rad/s (flick, not a sit-up)"
            else -> null
        }

        /** Why this doesn't look like a push-up with the hand on the floor, or null if it does. */
        private fun pushUpProblem(): String? {
            val forearm = repForearmSum / max(1, repSamples)
            return when {
                forearm < PUSH_UP_MIN_FOREARM_G ->
                    "forearm not upright (${"%.2f".format(forearm)} g): hand not on the floor"
                repMovePeak > PUSH_UP_MAX_MOVE ->
                    "wrist moved ${"%.1f".format(repMovePeak)} m/s²: hand not planted"
                !hasGyro -> null
                repTwist > PUSH_UP_MAX_TWIST ->
                    "forearm twisted ${"%.2f".format(repTwist)} rad (hand turned)"
                repTurn > 0.2f && repTwist / repTurn > PUSH_UP_MAX_TWIST_SHARE ->
                    "mostly twist (${"%.0f".format(100 * repTwist / repTurn)}%)"
                repSpinPeak > PUSH_UP_MAX_SPIN ->
                    "wrist spun ${"%.1f".format(repSpinPeak)} rad/s (flick, not a push-up)"
                else -> null
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private inner class BarometerListener : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            onBarometer(event.timestamp / 1_000_000L, event.values[0])
        }

        /** One pressure reading (hPa) at sensor time [now] (ms). */
        fun onBarometer(now: Long, hPa: Float) {
            baroSamples.addLast(now to hPa)
            diagnostics?.barometer(now, hPa)
            while (baroSamples.isNotEmpty() && now - baroSamples.first().first > BARO_KEEP_MS) {
                baroSamples.removeFirst()
            }
            if (plyoQueue.isNotEmpty()) {
                drainPlyo(now)
                refreshJumps()
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private inner class GyroListener : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            // gyroX/Y/Z and wristSpin are set per accelerometer sample, at its moment (SensorAligner)
            aligner.pushGyro(event.values[0], event.values[1], event.values[2], event.timestamp)
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private inner class StepListener : SensorEventListener {
        private var lastRaw = -1

        override fun onSensorChanged(event: SensorEvent) {
            val now = clock()
            if (event.sensor.type == Sensor.TYPE_STEP_COUNTER) {
                val total = event.values[0].toInt()
                // First event after (re)registering is the baseline, not new steps
                if (lastRaw >= 0 && counting()) addSteps(max(0, total - lastRaw), now)
                lastRaw = total
            } else if (counting()) {
                addSteps(1, now)
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private inner class HeartRateListener : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            onReading(event.accuracy, event.values[0].toInt(), event.timestamp / 1_000_000L)
        }

        /** One heart-rate reading: sensor [accuracy] status, [bpm], sensor time [t] (ms). */
        fun onReading(accuracy: Int, bpm: Int, t: Long) {
            when (accuracy) {
                SensorManager.SENSOR_STATUS_NO_CONTACT -> { setNoContact(true); noteHrLost() }
                SensorManager.SENSOR_STATUS_UNRELIABLE -> { setNoContact(false); noteHrLost() }
                else -> {
                    setNoContact(false)
                    if (bpm in 36..230) {
                        checkHrContinuity(bpm)
                        heartRate = bpm
                        val at = clock()
                        hrHistory.addLast(at to bpm)
                        while (hrHistory.isNotEmpty() && at - hrHistory.first().first > PLYO_HR_BASELINE_MS) hrHistory.removeFirst()
                        diagnostics?.heartRate(t, bpm)
                        if (drillStartHr == 0 && !paused) drillStartHr = bpm
                        confirmJumps(clock())
                        if (!paused && !wearerLocked) {
                            drillHrSum += bpm
                            drillHrCount += 1
                            if (bpm > drillHrMax) drillHrMax = bpm
                        }
                    }
                }
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
            setNoContact(accuracy == SensorManager.SENSOR_STATUS_NO_CONTACT)
        }

        /** The sensor lost its lock (no contact / unreliable): remember the rate before it. */
        private fun noteHrLost() {
            if (hrGapFrom == 0L && hrLastReliableAt > 0L) {
                hrGapFrom = clock()
                hrBeforeGap = medianBetween(hrGapFrom - HR_RECENT_MS, hrGapFrom) ?: 0
            }
        }

        /** A reliable reading: was there a jump one person's heart can't make? */
        private fun checkHrContinuity(bpm: Int) {
            val now = clock()
            hrSamples.addLast(now to bpm)
            while (hrSamples.isNotEmpty() && now - hrSamples.first().first > HR_BEFORE_FROM_MS + 5_000L) {
                hrSamples.removeFirst()
            }
            hrLastReliableAt = now
            // Checked during rests too: a hand-over is likeliest between drills
            if (wearerLocked || now - hrLastAnomalyAt < HR_ANOMALY_REFRACTORY_MS) {
                hrGapFrom = 0L
                return
            }

            // Back after losing the lock for a while, at a clearly different rate
            if (hrGapFrom > 0L) {
                val gap = now - hrGapFrom
                val before = hrBeforeGap
                hrGapFrom = 0L
                if (gap >= HR_GAP_MS && before > 0 && abs(bpm - before) >= HR_GAP_CHANGE_BPM) {
                    flagHr(now, "gap ${gap}ms $before -> $bpm")
                    return
                }
            }

            // Sudden change between two short windows 10 s apart
            val recent = medianBetween(now - HR_RECENT_MS, now, minCount = 3) ?: return
            val before = medianBetween(now - HR_BEFORE_FROM_MS, now - HR_BEFORE_TO_MS, minCount = 3) ?: return
            if (before - recent >= HR_DROP_BPM || recent - before >= HR_RISE_BPM) {
                flagHr(now, "jump $before -> $recent")
            }
        }

        private fun flagHr(now: Long, why: String) {
            hrAnomalies += 1
            hrLastAnomalyAt = now
            Log.d(TAG, "Heart-rate continuity broken ($why) -> phone will check identity")
        }

        private fun medianBetween(from: Long, to: Long, minCount: Int = 1): Int? {
            val values = hrSamples.filter { it.first in from..to }.map { it.second }.sorted()
            return if (values.size >= minCount) values[values.size / 2] else null
        }

        private fun setNoContact(noContact: Boolean) {
            hrNoContact = noContact
            if (noContact) heartRate = 0
            updateOnBody()
        }
    }

    private inner class OffBodyListener : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            offBodySensorSaysOn = event.values[0] != 0f
            updateOnBody()
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }
}
