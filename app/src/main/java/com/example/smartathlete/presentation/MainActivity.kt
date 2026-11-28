package com.example.smartathlete.presentation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.WindowManager
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import com.example.smartathlete.ble.BleGattServerManager
import com.example.smartathlete.tracking.DiagnosticRecorder
import com.example.smartathlete.tracking.DrillRecordStore
import com.example.smartathlete.tracking.SensorProfile
import com.example.smartathlete.tracking.WorkoutSensorTracker
import kotlinx.coroutines.delay
import org.json.JSONObject

data class DrillItem(
    val name: String,
    val durationMinutes: Int,
    val category: String = "Drill",
    /** Sensor profile key resolved by the phone for this workout */
    val profile: String? = null,
    /** Rest after this drill (s) as the coach set it; null = [REST_BETWEEN_DRILLS_SECONDS] */
    val restSeconds: Int? = null
) {
    /** Rest before the next drill, in seconds (0 = straight on). */
    val restAfter: Int get() = restSeconds ?: REST_BETWEEN_DRILLS_SECONDS
}

data class ActiveSessionData(
    /** Run id from the phone; echoed in telemetry so the phone can drop packets from older runs */
    val sid: String? = null,
    val title: String = "Training Session",
    val drillCount: Int = 0,
    val totalDurationMinutes: Int = 0,
    val drills: List<DrillItem> = emptyList()
)

/**
 * Where the phone's session is when the watch rejoins it (the watch fell back to its ready
 * screen, e.g. the app restarted, while the phone kept the session running). Sent inside
 * START_SESSION as "rejoin": the watch skips the countdown and carries on from these
 * numbers instead of starting from zero.
 */
data class RejoinPoint(
    val secs: Int,
    val drill: Int,
    val drillSecs: Int,
    val paused: Boolean,
    val steps: Int,
    val meters: Float,
    val jumps: Int,
    val reps: Int,
    val load: Float,
    val accel: Int
) {
    companion object {
        fun fromPayload(payload: String): RejoinPoint? = try {
            val r = JSONObject(payload.substring(payload.indexOf('{'))).optJSONObject("rejoin")
            r?.let {
                RejoinPoint(
                    secs = it.optInt("secs", 0).coerceAtLeast(0),
                    drill = it.optInt("drill", 0).coerceAtLeast(0),
                    drillSecs = it.optInt("drillSecs", 0).coerceAtLeast(0),
                    paused = it.optBoolean("paused", false),
                    steps = it.optInt("steps", 0).coerceAtLeast(0),
                    meters = it.optDouble("meters", 0.0).toFloat().coerceAtLeast(0f),
                    jumps = it.optInt("jumps", 0).coerceAtLeast(0),
                    reps = it.optInt("reps", 0).coerceAtLeast(0),
                    load = it.optDouble("load", 0.0).toFloat().coerceAtLeast(0f),
                    accel = it.optInt("acc", 0).coerceAtLeast(0)
                )
            }
        } catch (_: Exception) { null }
    }
}

data class ZoneUpdate(val index: Int?, val zone: String?, val metrics: Set<String>)

/** The session the athlete checked in to, shown on the watch home screen. */
data class CheckedInSession(
    val title: String,
    /** Venue name, or null for an at-home session */
    val venue: String?,
    val atHome: Boolean,
    val date: String?,
    val startTime: String?
) {
    fun toJson(): String = JSONObject()
        .put("title", title)
        .put("venue", venue ?: JSONObject.NULL)
        .put("atHome", atHome)
        .put("date", date ?: JSONObject.NULL)
        .put("startTime", startTime ?: JSONObject.NULL)
        .toString()

    companion object {
        /** From a SESSION_INFO / START_SESSION JSON payload; null when it carries no session. */
        fun fromJson(json: JSONObject): CheckedInSession? {
            val title = json.optString("title").takeIf { it.isNotBlank() } ?: return null
            val locationType = json.optString("locationType")
            val atHome = json.optBoolean("atHome", false) || locationType.equals("at_home", ignoreCase = true)
            fun str(key: String) = json.optString(key).takeIf { it.isNotBlank() && it != "null" }
            return CheckedInSession(
                title = title,
                venue = if (atHome) null else str("venue") ?: str("venueName"),
                atHome = atHome,
                date = str("date"),
                startTime = str("startTime")
            )
        }
    }
}

/**
 * A session the phone handed to the watch (ARM_SESSION:{json}): the athlete starts it from
 * the wrist. [startPayload] is the START_SESSION payload the start uses; [startsAt] / [endsAt]
 * are the scheduled times (epoch ms, 0 = unknown).
 */
data class ArmedSession(
    /** The phone's run id for it (null from older phone builds) */
    val sid: String?,
    val title: String,
    val startPayload: String,
    val startsAt: Long,
    val endsAt: Long,
    val wearer: WearerIdentity?,
) {
    fun toJson(): String = JSONObject()
        .put("title", title)
        .put("payload", startPayload)
        .put("startsAt", startsAt)
        .put("endsAt", endsAt)
        .put("wearer", wearer?.toJson())
        .toString()

    companion object {
        fun fromJson(raw: String): ArmedSession? = try {
            val o = JSONObject(raw)
            val payload = o.getString("payload")
            ArmedSession(
                sid = try { JSONObject(payload.substring(payload.indexOf('{'))).optString("sid").takeIf { it.isNotBlank() } } catch (_: Exception) { null },
                title = o.optString("title", "Training Session"),
                startPayload = payload,
                startsAt = o.optLong("startsAt", 0L),
                endsAt = o.optLong("endsAt", 0L),
                wearer = o.optString("wearer").takeIf { it.isNotBlank() && it != "null" }?.let { WearerIdentity.fromJson(it) },
            )
        } catch (_: Exception) { null }

        /** From the phone's "ARM_SESSION:{json}" (the session plan plus wearer and times). */
        fun fromCommand(command: String): ArmedSession? = try {
            val o = JSONObject(command.substring(command.indexOf('{')))
            val w = o.optJSONObject("wearer")
            ArmedSession(
                sid = o.optString("sid").takeIf { it.isNotBlank() },
                title = o.optString("title", "Training Session"),
                startPayload = "START_SESSION:" + o.toString(),
                startsAt = o.optLong("startsAt", 0L),
                endsAt = o.optLong("endsAt", 0L),
                wearer = w?.let {
                    WearerIdentity.fromCommand(
                        "WEARER=${it.optString("jersey")}|${it.optString("name", "Athlete")}"
                    )
                },
            )
        } catch (_: Exception) { null }
    }
}

/** The drill being recorded, so the watch can save it if the phone missed part of it. */
class DrillTrack {
    var sid: String? = null
    var index = 0
    var name = ""
    var startSecs = 0
    /** Time actually spent in the drill (pauses and the rest after it excluded) */
    var activeMs = 0L
    /** The phone was out of range at some point during this drill */
    var hadGap = false
}

/**
 * Session and drill time, measured on the real clock ([SystemClock.elapsedRealtime], which
 * keeps running while the watch sleeps). Adding 1 every second lost time whenever the
 * screen went off or a pause/resume restarted the loop (pilot 2026-11-26: the phone showed
 * 7 min for a 10-min session).
 *   session time  runs except while paused by the athlete; the rest between drills counts
 *                 (it is part of the training session, as the phone counts it)
 *   drill time    runs only while a drill is being done (not paused, not resting)
 */
class SessionClock {
    var elapsedMs = 0L
    var drillMs = 0L
    /** Real-clock time of the last tick; 0 = not ticking yet */
    var lastTickAt = 0L
    /** Rest time not yet taken off the rest countdown (under a second) */
    var restCarryMs = 0L
    /** When the watch was seen off the wrist (0 = on the wrist) */
    var offWristSince = 0L
    /** The drill [drillMs] belongs to (-1 = none yet) */
    var drillIndex = -1
}

/** Session loop tick: time, wrist checks (the phone is updated once a second). */
private const val TICK_MS = 250L
/** A longer gap between ticks than this is not counted (clock jump, app frozen for hours). */
private const val MAX_TICK_GAP_MS = 6 * 60 * 60 * 1000L

/**
 * Rest after a drill with no rest set by the coach (matches the phone). Otherwise each
 * drill's own rest is used ([DrillItem.restAfter]).
 */
private const val REST_BETWEEN_DRILLS_SECONDS = 180
/** How long the phone must be gone before the watch follows the session plan itself. */
private const val PHONE_GONE_MS = 10_000L
/**
 * Off the wrist this long during a session locks the watch until the phone re-verifies:
 * half a second, so the watch can't be moved quickly to someone else's wrist.
 */
private const val OFF_WRIST_LOCK_MS = 500L
/**
 * Watches without an off-body sensor only know wrist contact from the heart-rate sensor,
 * which blinks out mid-sprint: there, half a second without contact asks for an identity
 * check (the watch keeps counting), and only a longer loss locks it.
 */
private const val OFF_WRIST_LOCK_HR_ONLY_MS = 20_000L
private const val WRIST_BLIP_HR_ONLY_MS = 500L
/** Time the athlete has to confirm an identity check on their phone. */
private const val IDENTITY_CHECK_SECONDS = 60
/**
 * Still on the "watch was taken off" lock screen this long past the session's planned end
 * (all drills + rests): the phone ended the session but its END never arrived, so the
 * watch closes the session itself instead of waiting for a verification that won't come.
 */
private const val LOCKED_PAST_PLAN_END_SECONDS = 120
/**
 * The phone link must stay down this long during a session before the watch beeps and
 * buzzes, so a momentary Bluetooth blip doesn't set it off.
 */
private const val PHONE_DROP_ALERT_DELAY_MS = 3_000L

// Current drill types, then the ones older phone builds send
private val ZONE_NAMES = listOf(
    "Warm-up", "Running", "Strength", "Jumping", "Plyometrics", "Agility", "Cool-down",
    "Tactics", "Conditioning", "Scrimmage"
)
private val METRIC_KEYS = listOf("heartRate", "steps", "distance", "playerLoad", "speed", "jumps", "reps", "recovery")

fun parseZoneCommand(cmd: String): ZoneUpdate {
    val body = cmd.substringAfter(":", cmd)
    val index = Regex("^\\s*(\\d+)\\s*(?:[|,;]|$)").find(body)?.groupValues?.get(1)?.toIntOrNull()
    val zone = ZONE_NAMES.firstOrNull { body.contains(it, ignoreCase = true) }
        ?: body.split("|", ";").map { it.trim() }.firstOrNull { t ->
            t.any { it.isLetter() } && !t.startsWith("{") && METRIC_KEYS.none { t.contains(it, ignoreCase = true) }
        }
    val metrics = METRIC_KEYS.filter { body.contains(it, ignoreCase = true) }.toSet()
    return ZoneUpdate(index, zone, metrics)
}

/** The workout currently running on the phone, from a WORKOUT:{json} command. */
data class WorkoutCommand(
    val index: Int,
    val name: String,
    val category: String?,
    val profile: SensorProfile,
    val metrics: Set<String>
)

fun parseWorkoutCommand(cmd: String): WorkoutCommand? = try {
    val json = JSONObject(cmd.substring(cmd.indexOf('{')))
    val category = json.optString("c").takeIf { it.isNotBlank() }
    val metricsArr = json.optJSONArray("m")
    val metrics = (0 until (metricsArr?.length() ?: 0))
        .map { metricsArr!!.optString(it) }
        .filter { it in METRIC_KEYS }
        .toSet()
    WorkoutCommand(
        index = json.optInt("i", 0),
        name = json.optString("n"),
        category = category,
        profile = SensorProfile.fromKey(json.optString("p")) ?: SensorProfile.forCategory(category),
        metrics = metrics
    )
} catch (e: Exception) {
    Log.e("MainActivity", "Bad WORKOUT command: '$cmd'", e)
    null
}

@Composable
fun MetricCell(value: String, label: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, color = Color.White)
        Text(text = label, style = MaterialTheme.typography.bodyExtraSmall, color = color, fontWeight = FontWeight.Bold)
    }
}

class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "smartathlete_watch_prefs"
        private const val KEY_IS_LINKED = "is_device_linked"
        private const val KEY_LINKED_DEVICE_NAME = "linked_device_name"
        private const val KEY_PAIRING_CODE = "watch_pairing_code"
        private const val SESSION_DIM_AFTER_MS = 15_000L
        private const val SESSION_DIM_BRIGHTNESS = 0.05f
        /** Account (Supabase user id) this watch is linked to; only it may re-pair while linked */
        private const val KEY_LINKED_ACCOUNT = "linked_account_id"
        private const val KEY_WATCH_UID = "watch_uid"
        private const val KEY_CHECKED_IN_SESSION = "checked_in_session"
        private const val KEY_WEARER = "wearer_identity"
        private const val KEY_ARMED_SESSION = "armed_session"
        /** Unlinked on the watch while the phone was away: tell the phone when it connects */
        private const val KEY_UNLINK_NOTICE_PENDING = "unlink_notice_pending"

        /** Permanent ID for this watch, created once and never changed. */
        fun getOrCreateWatchUid(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.getString(KEY_WATCH_UID, null)?.takeIf { it.isNotBlank() }?.let { return it }
            val uid = java.util.UUID.randomUUID().toString()
            prefs.edit().putString(KEY_WATCH_UID, uid).apply()
            return uid
        }

        /** Account id sent by the phone with a pairing request ("CONFIRMED:<label>;acct=<id>"). */
        fun parseAccountId(raw: String?): String? =
            raw?.let { Regex(";acct=([^;|]+)").find(it)?.groupValues?.get(1)?.trim() }?.takeIf { it.isNotBlank() }

        fun getOrCreatePairingCode(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            var code = prefs.getString(KEY_PAIRING_CODE, null)
            if (code.isNullOrBlank() || code.length != 6) {
                code = String.format(java.util.Locale.US, "%06d", (100000..999999).random())
                prefs.edit().putString(KEY_PAIRING_CODE, code).apply()
            }
            return code
        }

        fun generateNewPairingCode(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val newCode = String.format(java.util.Locale.US, "%06d", (100000..999999).random())
            prefs.edit().putString(KEY_PAIRING_CODE, newCode).apply()
            return newCode
        }

        @android.annotation.SuppressLint("MissingPermission")
        fun triggerHapticVibration(context: Context) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager
                    val vibrator = vibratorManager?.defaultVibrator
                    vibrator?.vibrate(android.os.VibrationEffect.createOneShot(300L, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(300L)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Vibration failed: ${e.message}")
            }
        }

        /** Long-short-long pattern that marks the end of a session. */
        @android.annotation.SuppressLint("MissingPermission")
        fun triggerSessionCompleteVibration(context: Context) {
            try {
                val pattern = longArrayOf(0, 700, 250, 700, 250, 1200)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager
                    vm?.defaultVibrator?.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(pattern, -1)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Session complete vibration failed: ${e.message}")
            }
        }

        /** Strong triple-pulse used for venue boundary warnings. */
        @android.annotation.SuppressLint("MissingPermission")
        fun triggerGeofenceWarningVibration(context: Context) {
            try {
                val pattern = longArrayOf(0, 500, 200, 500, 200, 500)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager
                    vm?.defaultVibrator?.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(pattern, -1)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Geofence vibration failed: ${e.message}")
            }
        }

        /** Plays a short tone on the watch speaker (alarm stream, so it sounds with media muted). */
        private fun playTone(toneType: Int, durationMs: Int) {
            try {
                val tone = android.media.ToneGenerator(android.media.AudioManager.STREAM_ALARM, 90)
                tone.startTone(toneType, durationMs)
                Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, durationMs + 200L)
            } catch (e: Exception) {
                // No speaker, or audio busy: the vibration still goes off
                Log.w(TAG, "Tone failed: ${e.message}")
            }
        }

        @android.annotation.SuppressLint("MissingPermission")
        private fun vibratePattern(context: Context, pattern: LongArray) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager
                    vm?.defaultVibrator?.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(pattern, -1)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Vibration failed: ${e.message}")
            }
        }

        /**
         * The phone dropped mid-session: falling two-tone beep plus long-long buzz, unlike
         * the geofence triple pulse or the drill-change single buzz.
         */
        fun triggerPhoneLostAlert(context: Context) {
            vibratePattern(context, longArrayOf(0, 900, 300, 900))
            playTone(android.media.ToneGenerator.TONE_CDMA_ABBR_ALERT, 1_000)
        }

        /** Rest between drills has started: two firm pulses and a double beep. */
        fun triggerRestStartAlert(context: Context) {
            vibratePattern(context, longArrayOf(0, 400, 200, 400))
            playTone(android.media.ToneGenerator.TONE_PROP_BEEP2, 500)
        }

        /** The phone is back after a drop alert: quick double tap and a short acknowledge beep. */
        fun triggerPhoneBackAlert(context: Context) {
            vibratePattern(context, longArrayOf(0, 120, 120, 120))
            playTone(android.media.ToneGenerator.TONE_PROP_ACK, 300)
        }

        fun parseSessionData(payload: String): ActiveSessionData {
            return try {
                val jsonStartIndex = payload.indexOf("{")
                val jsonStr = if (jsonStartIndex >= 0) {
                    payload.substring(jsonStartIndex)
                } else {
                    payload
                        .replace("START_SESSION:", "", ignoreCase = true)
                        .replace("SESSION_START:", "", ignoreCase = true)
                        .trim()
                }

                val jsonObj = JSONObject(jsonStr)
                val title = jsonObj.optString("title", "Training Session")
                val drillCount = jsonObj.optInt("drillCount", 0)
                val totalDurationMinutes = jsonObj.optInt("totalDurationMinutes", 0)

                val drillsList = mutableListOf<DrillItem>()
                val drillsArr = jsonObj.optJSONArray("drills")
                if (drillsArr != null) {
                    for (i in 0 until drillsArr.length()) {
                        val itemObj = drillsArr.getJSONObject(i)
                        drillsList.add(
                            DrillItem(
                                name = itemObj.optString("name", "Drill #${i + 1}"),
                                durationMinutes = itemObj.optInt("durationMinutes", 10),
                                category = itemObj.optString("category", "Drill"),
                                profile = itemObj.optString("profile").takeIf { it.isNotBlank() },
                                restSeconds = itemObj.optInt("rest", -1).takeIf { it >= 0 }
                            )
                        )
                    }
                }

                val finalCount = if (drillCount > 0) drillCount else drillsList.size.coerceAtLeast(1)
                val finalMinutes = if (totalDurationMinutes > 0) totalDurationMinutes else drillsList.sumOf { it.durationMinutes }.coerceAtLeast(15)

                ActiveSessionData(
                    sid = jsonObj.optString("sid").takeIf { it.isNotBlank() },
                    title = title,
                    drillCount = finalCount,
                    totalDurationMinutes = finalMinutes,
                    drills = drillsList
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing session data payload: '$payload'", e)
                ActiveSessionData(
                    title = "Training Session",
                    drillCount = 3,
                    totalDurationMinutes = 30,
                    drills = listOf(
                        DrillItem("Light jog", 10, "Warm-up"),
                        DrillItem("Push-ups, Squats", 10, "Strength"),
                        DrillItem("Easy walk", 10, "Cool-down")
                    )
                )
            }
        }
    }

    private lateinit var bleManager: BleGattServerManager

    // ─── Screen & battery ───
    // The screen follows the watch's own sleep timeout, except while a session (or a
    // prompt / drill sync) needs the app running. During a session it dims after a short
    // idle period instead of sleeping, so tracking keeps running at low power.
    private val screenHandler = Handler(Looper.getMainLooper())
    private var dimWhenIdle = false
    private val dimRunnable = Runnable { setScreenBrightness(SESSION_DIM_BRIGHTNESS) }

    private fun setScreenBrightness(level: Float) {
        val attrs = window.attributes
        if (attrs.screenBrightness != level) {
            attrs.screenBrightness = level
            window.attributes = attrs
        }
    }

    // CPU stays awake for a running session even with the screen off (see SessionKeepAliveService)
    private var sessionWakeLock: android.os.PowerManager.WakeLock? = null

    /**
     * Keeps the app reachable and running with the screen off:
     *   [linked]   linked to a phone: the app stays running (foreground service, no wake
     *              lock) so the phone connects by itself whenever the two are near each
     *              other, without a ping (the system otherwise pauses an app in the
     *              background, and the phone couldn't reach it)
     *   [running]  a session runs or waits on the wrist: the CPU stays awake too, for the
     *              sensors and the session clock
     */
    fun setAppAwake(linked: Boolean, running: Boolean) {
        if (running) {
            if (sessionWakeLock?.isHeld != true) {
                val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                sessionWakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "SmartAthlete:session").apply {
                    setReferenceCounted(false)
                    // Safety limit; a session never runs this long
                    acquire(4 * 60 * 60 * 1000L)
                }
            }
        } else {
            try { sessionWakeLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
            sessionWakeLock = null
        }
        if (running || linked) com.example.smartathlete.tracking.SessionKeepAliveService.start(this, running)
        else com.example.smartathlete.tracking.SessionKeepAliveService.stop(this)
    }

    /** Keep the screen on (session running) or let it sleep normally. */
    fun setKeepScreenOn(keepOn: Boolean) {
        if (keepOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Dim after [SESSION_DIM_AFTER_MS] without interaction (only while a session runs). */
    fun setDimWhenIdle(enabled: Boolean) {
        dimWhenIdle = enabled
        if (enabled) wakeScreen() else {
            screenHandler.removeCallbacks(dimRunnable)
            setScreenBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE)
        }
    }

    /** Full brightness now (touch, crown, drill change, session end); dims again later. */
    fun wakeScreen() {
        setScreenBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE)
        screenHandler.removeCallbacks(dimRunnable)
        if (dimWhenIdle) screenHandler.postDelayed(dimRunnable, SESSION_DIM_AFTER_MS)
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (dimWhenIdle) wakeScreen()
        return super.dispatchTouchEvent(ev)
    }

    // Rotary bezel / crown
    override fun dispatchGenericMotionEvent(ev: MotionEvent?): Boolean {
        if (dimWhenIdle) wakeScreen()
        return super.dispatchGenericMotionEvent(ev)
    }
    private var sensorManager: SensorManager? = null

    private fun checkBlePermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private var hasPermissions by mutableStateOf(false)
    private var hasBlePermissions by mutableStateOf(false)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        hasPermissions = permissions.values.all { it }
        hasBlePermissions = checkBlePermissions()
    }

    private var onGattPairingConfirmed: ((String?) -> Unit)? = null
    private var onGattUnlinkRequested: ((String?) -> Unit)? = null
    private var onGattSessionStart: ((String) -> Unit)? = null
    private var onGattSessionControl: ((String) -> Unit)? = null
    private var onGattPingReceived: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setTheme(android.R.style.Theme_DeviceDefault)

        // Screen stays on only while needed (see setKeepScreenOn in setContent)
        bleManager = BleGattServerManager(this)
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager

        checkAndRequestPermissions()

        setContent {
            val context = LocalContext.current
            val prefs = remember {
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            }

            var isLinked by remember {
                mutableStateOf(prefs.getBoolean(KEY_IS_LINKED, false))
            }

            var linkedDeviceName by remember {
                mutableStateOf(prefs.getString(KEY_LINKED_DEVICE_NAME, "Mobile Phone") ?: "Mobile Phone")
            }

            var pairingCode by remember {
                mutableStateOf(getOrCreatePairingCode(context))
            }

            var isAdvertising by remember { mutableStateOf(false) }
            var lastPingMessage by remember { mutableStateOf<String?>(null) }

            LaunchedEffect(lastPingMessage) {
                if (lastPingMessage != null) {
                    delay(3500L)
                    lastPingMessage = null
                }
            }

            var pendingDeviceName by remember { mutableStateOf<String?>(null) }
            var pendingAccountId by remember { mutableStateOf<String?>(null) }
            val watchUid = remember { getOrCreateWatchUid(context) }
            var pendingUnlinkDeviceName by remember { mutableStateOf<String?>(null) }
            // Unlink started from the watch's own Unlink button (vs. requested by the phone)
            var unlinkFromWatch by remember { mutableStateOf(false) }
            var unlinkWaitingForPhone by remember { mutableStateOf(false) }
            var unlinkPhoneNoAnswer by remember { mutableStateOf(false) }

            var activeSessionState by remember { mutableStateOf<ActiveSessionData?>(null) }
            // Set when the phone puts the watch back into its running session; consumed once
            // the tracking starts (time, drill and totals carry on instead of resetting)
            var pendingRejoin by remember { mutableStateOf<RejoinPoint?>(null) }
            var rejoinDrillSecs by remember { mutableStateOf<Int?>(null) }

            // Session the athlete checked in to (kept across restarts)
            var checkedInSession by remember {
                mutableStateOf(
                    prefs.getString(KEY_CHECKED_IN_SESSION, null)?.let {
                        try { CheckedInSession.fromJson(JSONObject(it)) } catch (_: Exception) { null }
                    }
                )
            }
            fun saveCheckedInSession(info: CheckedInSession?) {
                checkedInSession = info
                prefs.edit().apply {
                    if (info == null) remove(KEY_CHECKED_IN_SESSION) else putString(KEY_CHECKED_IN_SESSION, info.toJson())
                }.apply()
            }
            var isCountdownActive by remember { mutableStateOf(false) }
            var countdownSeconds by remember { mutableIntStateOf(3) }
            var currentDrillIndex by remember { mutableIntStateOf(0) }
            var currentZone by remember { mutableStateOf<String?>(null) }
            var zoneMetrics by remember { mutableStateOf<Set<String>>(emptySet()) }

            var elapsedSeconds by remember { mutableIntStateOf(0) }
            var drillSeconds by remember { mutableIntStateOf(0) }
            val sessionClock = remember { SessionClock() }
            var isSessionPaused by remember { mutableStateOf(false) }

            // The workout the phone says is running; null until the first WORKOUT command
            var workoutCommand by remember { mutableStateOf<WorkoutCommand?>(null) }

            // Sensors for the current workout: the phone's WORKOUT command wins for its drill;
            // otherwise use the drill's own profile (the athlete advanced from the wrist)
            val currentDrill = activeSessionState?.drills?.getOrNull(currentDrillIndex)
            val currentProfile = workoutCommand?.takeIf { it.index == currentDrillIndex }?.profile
                ?: SensorProfile.fromKey(currentDrill?.profile)
                ?: SensorProfile.forCategory(currentDrill?.category ?: currentZone)

            // Debug builds also record raw sensor data of jump / plyo / strength drills for
            // accuracy testing (null in release builds)
            val tracker = remember {
                WorkoutSensorTracker(sensorManager).apply { diagnostics = DiagnosticRecorder.forDebugBuild(context) }
            }
            val isTracking = activeSessionState != null && !isCountdownActive

            // ─── Wearer verification ───
            // The phone verified the athlete (fingerprint / face, next to the watch) before
            // starting. From then on the watch trusts whoever wears it only while it stays on
            // the wrist: taken off, or a random re-check from the phone, locks it until the
            // phone verifies again. Nothing is counted while locked.
            var wearer by remember {
                mutableStateOf(prefs.getString(KEY_WEARER, null)?.let { WearerIdentity.fromJson(it) })
            }
            // Identity check from the phone: seconds left to confirm (0 = none). The watch keeps
            // counting; a missed check is flagged on the phone for the coach.
            var identityCheckSeconds by remember { mutableIntStateOf(0) }
            var identityCheckId by remember { mutableIntStateOf(0) }
            // Under supervision: only the coach can unlock (approved in the coach's app)
            var awaitingCoach by remember { mutableStateOf(false) }

            // ─── Phone out of range ───
            // The watch keeps recording. Drills the phone missed are saved here until the
            // phone is back in range and confirms it has them.
            val recordStore = remember { DrillRecordStore(context) }
            val drillTrack = remember { DrillTrack() }
            var phoneConnected by remember { mutableStateOf(bleManager.isPhoneConnected()) }
            var phoneLostAt by remember { mutableStateOf(SystemClock.elapsedRealtime()) }
            var restRemaining by remember { mutableIntStateOf(0) }
            // ─── Unlink ───
            /** Back to pairing mode. [noticeForPhone]: the phone didn't confirm; tell it later. */
            fun unlinkWatch(noticeForPhone: Boolean) {
                val freshCode = generateNewPairingCode(context)
                prefs.edit()
                    .putBoolean(KEY_IS_LINKED, false)
                    .remove(KEY_LINKED_DEVICE_NAME)
                    .remove(KEY_LINKED_ACCOUNT)
                    .putBoolean(KEY_UNLINK_NOTICE_PENDING, noticeForPhone)
                    .apply()
                pairingCode = freshCode
                isLinked = false
                pendingUnlinkDeviceName = null
                unlinkFromWatch = false
                unlinkWaitingForPhone = false
                unlinkPhoneNoAnswer = false
            }

            DisposableEffect(Unit) {
                bleManager.onWatchUnlinkReply = { reply ->
                    runOnUiThread {
                        when (reply) {
                            "CONFIRMED" -> if (unlinkWaitingForPhone) {
                                triggerHapticVibration(context)
                                unlinkWatch(noticeForPhone = false)
                                lastPingMessage = "Unlinked from phone ✓"
                            }
                            "DECLINED" -> if (unlinkWaitingForPhone) {
                                unlinkWaitingForPhone = false
                                unlinkFromWatch = false
                                pendingUnlinkDeviceName = null
                                lastPingMessage = "Phone kept the watch linked"
                            }
                            "NOTICE_ACK" -> prefs.edit().remove(KEY_UNLINK_NOTICE_PENDING).apply()
                        }
                    }
                }
                onDispose { bleManager.onWatchUnlinkReply = null }
            }

            // No answer from the phone in time: offer unlinking on the watch only
            LaunchedEffect(unlinkWaitingForPhone) {
                if (unlinkWaitingForPhone) {
                    delay(60_000L)
                    if (unlinkWaitingForPhone) {
                        unlinkWaitingForPhone = false
                        unlinkPhoneNoAnswer = true
                    }
                }
            }

            // ─── Session handed to the watch ───
            // After a successful ping, the phone can hand the session over: the athlete starts
            // it from the wrist and the phone stays on the bench. The phone verified the athlete
            // (face check) before arming, so the hand-over only holds while the watch stays on
            // the wrist: taking it off cancels it (no session starts without a face check).
            var armedSession by remember {
                mutableStateOf(prefs.getString(KEY_ARMED_SESSION, null)?.let { ArmedSession.fromJson(it) })
            }
            // Why the last hand-over was cancelled, kept on the home screen until the next one
            // (a passing message was easy to miss: "there's no Start on the watch")
            var handOverNotice by remember { mutableStateOf<String?>(null) }
            fun disarmSession(why: String?) {
                if (why == null) handOverNotice = null
                if (armedSession == null) return
                armedSession = null
                prefs.edit().remove(KEY_ARMED_SESSION).apply()
                if (why != null) {
                    Log.d(TAG, "Hand-over cancelled: $why")
                    lastPingMessage = why
                    handOverNotice = why
                }
            }

            // ─── End of session ───
            // Title of the session that just ended (shows the "complete" screen), and the
            // final packet telling the phone when the watch ended it
            var completedTitle by remember { mutableStateOf<String?>(null) }
            // Most drills waiting at once since the session ended, for "2 / 3 synced"
            var syncTotal by remember { mutableIntStateOf(0) }
            // The athlete chose "Sync later"; drills still sync in the background
            var syncLater by remember { mutableStateOf(false) }
            var completedPacket by remember { mutableStateOf<String?>(null) }

            /**
             * Ends the session on the watch: vibrates and shows the complete screen.
             * [tellPhone] when the watch ended it (last drill's time, or the wrist buttons);
             * not when the phone sent END, since the phone already knows.
             */
            fun finishSession(tellPhone: Boolean, endedEarly: Boolean = false) {
                val sess = activeSessionState ?: return
                if (tellPhone) {
                    completedPacket = tracker.telemetryJson(
                        elapsedSeconds, true, currentDrillIndex, sess.sid, completed = true,
                        why = if (endedEarly) "ended_early" else "completed"
                    )
                }
                completedTitle = sess.title
                // The session is over: nothing left to verify
                tracker.unlockWearer()
                identityCheckSeconds = 0
                awaitingCoach = false
                syncTotal = 0
                saveCheckedInSession(null)
                restRemaining = 0
                triggerSessionCompleteVibration(context)
                activeSessionState = null
                isCountdownActive = false
                currentZone = null
                zoneMetrics = emptySet()
                workoutCommand = null
            }

            /**
             * Starts (or rejoins) a session from a START_SESSION payload: sent by the phone, or
             * the armed session the athlete starts from the wrist ([armedSession]).
             */
            fun startSessionFromPayload(payload: String) {
                Log.d(TAG, "Session start: $payload")
                val session = parseSessionData(payload)
                val rejoin = RejoinPoint.fromPayload(payload)
                if (rejoin != null) {
                    // Already running this very session: nothing to rejoin
                    val running = activeSessionState
                    if (running != null && session.sid != null && running.sid == session.sid) {
                        Log.d(TAG, "Rejoin for the session already running -> ignored")
                        return
                    }
                    Log.d(TAG, "Rejoining the phone's running session at ${rejoin.secs}s, drill ${rejoin.drill}")
                    disarmSession(null)
                    bleManager.resetSessionState()
                    activeSessionState = session
                    completedTitle = null
                    completedPacket = null
                    val total = maxOf(session.drills.size, session.drillCount, 1)
                    currentDrillIndex = rejoin.drill.coerceIn(0, total - 1)
                    workoutCommand = null
                    // Same zone the phone's next WORKOUT names, so it doesn't restart the drill timer
                    currentZone = session.drills.getOrNull(currentDrillIndex)?.category?.takeIf { it.isNotBlank() }
                    restRemaining = 0
                    pendingRejoin = rejoin
                    rejoinDrillSecs = rejoin.drillSecs
                    isCountdownActive = false
                    wakeScreen()
                    triggerPhoneBackAlert(context)
                    lastPingMessage = "Back in session ✓"
                    return
                }
                try {
                    CheckedInSession.fromJson(JSONObject(payload.substring(payload.indexOf('{'))))
                        ?.takeIf { it.venue != null || it.atHome }
                        ?.let { saveCheckedInSession(it) }
                } catch (_: Exception) {}
                // Started: it is no longer waiting on the wrist
                disarmSession(null)
                // Don't let the previous run's last packet reach the phone
                bleManager.resetSessionState()
                activeSessionState = session
                completedTitle = null
                completedPacket = null
                currentDrillIndex = 0
                workoutCommand = null
                isCountdownActive = true
            }

            // Repeat the "completed" packet briefly so the phone gets it by notification or poll
            LaunchedEffect(completedPacket) {
                val packet = completedPacket ?: return@LaunchedEffect
                repeat(6) {
                    bleManager.sendLiveTelemetry(packet)
                    delay(1000L)
                }
            }

            LaunchedEffect(recordStore.pendingCount) {
                if (recordStore.pendingCount == 0) syncLater = false
            }

            // Track the sync total while the complete screen is up
            LaunchedEffect(completedTitle, recordStore.pendingCount) {
                if (completedTitle != null) syncTotal = maxOf(syncTotal, recordStore.pendingCount)
            }

            // The complete screen goes home by itself, but only once nothing is left to sync
            LaunchedEffect(completedTitle, recordStore.pendingCount) {
                if (completedTitle != null && recordStore.pendingCount == 0) {
                    delay(if (syncTotal > 0) 5_000L else 15_000L)
                    completedTitle = null
                }
            }

            DisposableEffect(Unit) {
                bleManager.onPhoneConnectionChanged = { connected ->
                    runOnUiThread {
                        phoneConnected = connected
                        if (!connected) phoneLostAt = SystemClock.elapsedRealtime()
                    }
                }
                onDispose { bleManager.onPhoneConnectionChanged = null }
            }

            // ─── Phone dropped mid-session ───
            // Beep and buzz once the link has stayed down for a moment (the watch keeps
            // recording), and chime when it comes back. Only while a session runs on the
            // watch: a watch sitting on its ready screen has nothing to warn about.
            val sessionOnWatch = activeSessionState != null
            var phoneDropAlerted by remember { mutableStateOf(false) }
            LaunchedEffect(phoneConnected, sessionOnWatch) {
                if (!sessionOnWatch) {
                    phoneDropAlerted = false
                } else if (!phoneConnected && !phoneDropAlerted) {
                    delay(PHONE_DROP_ALERT_DELAY_MS)
                    // Cancelled if the phone came back or the session ended meanwhile
                    phoneDropAlerted = true
                    wakeScreen()
                    triggerPhoneLostAlert(context)
                    lastPingMessage = "⚠ Phone disconnected · still recording"
                } else if (phoneConnected && phoneDropAlerted) {
                    phoneDropAlerted = false
                    wakeScreen()
                    triggerPhoneBackAlert(context)
                    lastPingMessage = "Phone reconnected ✓"
                }
            }

            // When tracking began (wall clock, keeps running while paused or locked)
            var trackingStartedAt by remember { mutableStateOf(0L) }

            // Fresh totals when a session's countdown finishes
            DisposableEffect(activeSessionState, isCountdownActive) {
                if (isTracking) {
                    val rejoin = pendingRejoin
                    pendingRejoin = null
                    tracker.reset()
                    if (rejoin != null) {
                        // Back into the phone's running session: carry on where it is
                        trackingStartedAt = SystemClock.elapsedRealtime() - rejoin.secs * 1000L
                        tracker.carryOver(rejoin.steps, rejoin.meters, rejoin.jumps, rejoin.reps, rejoin.load, rejoin.accel)
                        isSessionPaused = rejoin.paused
                        elapsedSeconds = rejoin.secs
                    } else {
                        trackingStartedAt = SystemClock.elapsedRealtime()
                        isSessionPaused = false
                        elapsedSeconds = 0
                    }
                    sessionClock.elapsedMs = elapsedSeconds * 1000L
                    sessionClock.lastTickAt = SystemClock.elapsedRealtime()
                    sessionClock.restCarryMs = 0L
                    sessionClock.offWristSince = 0L
                    // The first tick starts the drill time afresh (or at the rejoin's)
                    sessionClock.drillIndex = -1
                }
                onDispose {}
            }

            // Switch sensors whenever the workout's profile changes; totals carry over
            DisposableEffect(isTracking, currentProfile) {
                if (isTracking) tracker.start(currentProfile)
                onDispose { tracker.stop() }
            }

            SideEffect {
                tracker.paused = isSessionPaused
                // Push-ups, sit-ups, jumping jacks… each move the wrist differently
                tracker.setDrillName(
                    workoutCommand?.takeIf { it.index == currentDrillIndex }?.name?.takeIf { it.isNotBlank() }
                        ?: currentDrill?.name
                )
            }

            /**
             * Off the wrist during a session: lock after half a second (off-body sensor), or
             * [OFF_WRIST_LOCK_HR_ONLY_MS] on heart-rate-only watches. Back on before that = a
             * brief removal, which the phone follows with an identity check.
             *
             * Checked from the session's tick loop, not from a composition effect: taking the
             * watch off turns its screen off, and a screen that isn't drawing doesn't recompose,
             * so an effect keyed on the wrist state didn't run until the screen came back
             * (pilot 2026-11-26: off the wrist for a minute without locking, then a lock long
             * after the session when the watch was picked up).
             */
            fun checkWrist(now: Long) {
                if (tracker.wearerLocked) {
                    sessionClock.offWristSince = 0L
                    return
                }
                if (!tracker.onBody) {
                    if (sessionClock.offWristSince == 0L) sessionClock.offWristSince = now
                    val limit = if (tracker.hasOffBodySensor) OFF_WRIST_LOCK_MS else OFF_WRIST_LOCK_HR_ONLY_MS
                    if (now - sessionClock.offWristSince >= limit) {
                        sessionClock.offWristSince = 0L
                        tracker.lockWearer("off_wrist")
                        Log.d(TAG, "Watch off the wrist during session -> locked")
                        wakeScreen()
                        triggerGeofenceWarningVibration(context)
                        // Tell the phone at once rather than at the next tick
                        bleManager.sendLiveTelemetry(
                            tracker.telemetryJson(elapsedSeconds, isSessionPaused, currentDrillIndex, activeSessionState?.sid, drillSecs = drillSeconds)
                        )
                    }
                } else if (sessionClock.offWristSince != 0L) {
                    val offFor = now - sessionClock.offWristSince
                    sessionClock.offWristSince = 0L
                    if (tracker.hasOffBodySensor || offFor >= WRIST_BLIP_HR_ONLY_MS) {
                        tracker.noteWristBlip()
                        Log.d(TAG, "Brief removal from the wrist (${offFor}ms) -> phone will check identity")
                    }
                }
            }
            // Identity check: buzz now and every 20 s, count down, then close it
            LaunchedEffect(identityCheckId) {
                if (identityCheckId == 0) return@LaunchedEffect
                identityCheckSeconds = IDENTITY_CHECK_SECONDS
                while (identityCheckSeconds > 0) {
                    if (identityCheckSeconds % 20 == 0) {
                        wakeScreen()
                        triggerGeofenceWarningVibration(context)
                    }
                    delay(1000L)
                    identityCheckSeconds -= 1
                }
            }
            // Buzz and light up whenever it locks, and keep reminding until verified
            LaunchedEffect(tracker.wearerLocked, isTracking) {
                while (tracker.wearerLocked && isTracking) {
                    wakeScreen()
                    triggerGeofenceWarningVibration(context)
                    delay(20_000L)
                }
            }

            // Countdown Effect (3... 2... 1... GO!)
            LaunchedEffect(isCountdownActive, activeSessionState) {
                if (isCountdownActive && activeSessionState != null) {
                    countdownSeconds = 3
                    while (countdownSeconds > 0) {
                        delay(1000L)
                        countdownSeconds -= 1
                    }
                    triggerHapticVibration(context)
                    isCountdownActive = false
                }
            }

            // Drill boundaries (any cause: phone command, wrist button, watch running alone)
            LaunchedEffect(activeSessionState, currentDrillIndex, isCountdownActive) {
                val sess = activeSessionState
                val tracking = sess != null && !isCountdownActive
                val prevSid = drillTrack.sid
                if (prevSid != null && (!tracking || sess?.sid != prevSid || currentDrillIndex != drillTrack.index)) {
                    if (drillTrack.hadGap) {
                        val sessionOver = !tracking || sess?.sid != prevSid
                        recordStore.add(
                            tracker.drillRecord(
                                sid = prevSid,
                                index = drillTrack.index,
                                name = drillTrack.name,
                                startSecs = drillTrack.startSecs,
                                // Drill time only: session time now includes the rest after it
                                endSecs = drillTrack.startSecs + (drillTrack.activeMs / 1000L).toInt(),
                                done = sessionOver,
                                sessionSecs = elapsedSeconds
                            )
                        )
                        Log.d(TAG, "Saved drill ${drillTrack.index} on watch for later sync")
                    }
                    drillTrack.sid = null
                }
                val sid = sess?.sid
                if (tracking && drillTrack.sid == null && sess != null && sid != null) {
                    drillTrack.sid = sid
                    drillTrack.index = currentDrillIndex
                    drillTrack.name = sess.drills.getOrNull(currentDrillIndex)?.name ?: "Drill ${currentDrillIndex + 1}"
                    drillTrack.startSecs = elapsedSeconds
                    drillTrack.activeMs = 0L
                    drillTrack.hadGap = !phoneConnected
                    tracker.markDrillStart()
                }
            }

            // Whenever the phone is in range: send the oldest stored drill record (re-sent until
            // confirmed), then a status saying how many are left and whether a session is
            // running. "No session, 0 left" tells the phone it has everything and can stop waiting.
            LaunchedEffect(Unit) {
                while (true) {
                    delay(2000L)
                    if (!phoneConnected) continue
                    recordStore.next()?.let {
                        bleManager.sendDrillRecord(it.toString())
                        delay(300L) // let the notification go out before the next one
                    }
                    if (prefs.getBoolean(KEY_UNLINK_NOTICE_PENDING, false)) {
                        bleManager.sendDrillRecord(org.json.JSONObject().put("t", "unlinked").toString())
                        delay(300L)
                    }
                    val status = org.json.JSONObject()
                        .put("t", "sync")
                        .put("pend", recordStore.pendingCount)
                        .put("active", activeSessionState != null)
                        // Which run: the phone starts its side of a session started on the watch
                        .put("sid", activeSessionState?.sid ?: org.json.JSONObject.NULL)
                        // The session handed over to start from the wrist (the phone retracts
                        // its own copy once the watch dropped it: taken off, or time over)
                        .put("armed", armedSession?.sid ?: org.json.JSONObject.NULL)
                    bleManager.sendDrillRecord(status.toString())
                }
            }

            // Screen policy: awake only while the app must keep running or the athlete must
            // respond; otherwise the watch sleeps on its own timeout
            val sessionRunning = activeSessionState != null
            val needsAnswer = pendingDeviceName != null || pendingUnlinkDeviceName != null
            val syncingAfterSession = completedTitle != null && recordStore.pendingCount > 0
            val keepScreenOn = sessionRunning || needsAnswer || syncingAfterSession
            DisposableEffect(keepScreenOn) {
                setKeepScreenOn(keepScreenOn)
                onDispose {}
            }
            // Armed too: the watch must stay reachable and notice being taken off
            val keepAlive = sessionRunning || armedSession != null
            DisposableEffect(keepAlive, isLinked) {
                setAppAwake(linked = isLinked, running = keepAlive)
                onDispose {}
            }

            // The hand-over lapses when the session's time is over
            LaunchedEffect(armedSession) {
                val armed = armedSession ?: return@LaunchedEffect
                while (armedSession === armed) {
                    if (armed.endsAt > 0L && System.currentTimeMillis() >= armed.endsAt) {
                        disarmSession("Session time is over")
                        break
                    }
                    delay(30_000L)
                }
            }

            // Taken off the wrist while waiting to start: the face check no longer covers the
            // wearer, so the hand-over is cancelled (the athlete verifies again on the phone).
            // Uses the off-body sensor; watches without one rely on the session's own checks.
            val watchArmedOnly = armedSession != null && activeSessionState == null
            DisposableEffect(watchArmedOnly) {
                val sm = sensorManager
                val sensor = sm?.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT, true)
                    ?: sm?.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT)
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        if (event.values[0] == 0f) runOnUiThread {
                            if (armedSession != null && activeSessionState == null) {
                                disarmSession("Watch was taken off. Open the session on your phone and ping the watch to start from it again.")
                                wakeScreen()
                                triggerGeofenceWarningVibration(context)
                            }
                        }
                    }
                    override fun onAccuracyChanged(s: Sensor?, a: Int) {}
                }
                if (watchArmedOnly && sm != null && sensor != null) {
                    sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
                }
                onDispose { sm?.unregisterListener(listener) }
            }
            // While tracking (not the countdown), dim when idle instead of full brightness
            val dimDuringSession = sessionRunning && !isCountdownActive
            DisposableEffect(dimDuringSession) {
                setDimWhenIdle(dimDuringSession)
                onDispose {}
            }
            // Brighten for things the athlete should see: drill change, rest, session end
            LaunchedEffect(currentDrillIndex, restRemaining > 0, completedTitle) {
                wakeScreen()
            }

            // Restart the per-zone timer whenever the zone/drill changes or a session (re)starts
            LaunchedEffect(currentDrillIndex, currentZone, isCountdownActive, activeSessionState) {
                // A rejoin continues the drill the phone is part-way through
                drillSeconds = rejoinDrillSecs ?: 0
                sessionClock.drillMs = drillSeconds * 1000L
                sessionClock.drillIndex = currentDrillIndex
                rejoinDrillSecs = null
            }

            // Pause / resume / rest reach the phone straight away (the loop below doesn't
            // restart for them, so the clock never loses the part-second it was in)
            LaunchedEffect(isSessionPaused) {
                if (!isCountdownActive && activeSessionState != null) {
                    bleManager.sendLiveTelemetry(tracker.telemetryJson(elapsedSeconds, isSessionPaused, currentDrillIndex, activeSessionState?.sid, drillSecs = drillSeconds))
                }
            }

            // Live Timer & BLE Telemetry Broadcast Effect when tracking session is active.
            // Pause and rest are read on every tick (not keys of this effect): see SessionClock.
            LaunchedEffect(isCountdownActive, activeSessionState) {
                if (!isCountdownActive && activeSessionState != null) {
                    // Send initial telemetry immediately
                    bleManager.sendLiveTelemetry(tracker.telemetryJson(elapsedSeconds, isSessionPaused, currentDrillIndex, activeSessionState?.sid, drillSecs = drillSeconds))
                    if (sessionClock.lastTickAt == 0L) sessionClock.lastTickAt = SystemClock.elapsedRealtime()
                    var lastSentAt = 0L

                    while (true) {
                        delay(TICK_MS)
                        val now = SystemClock.elapsedRealtime()
                        val dt = (now - sessionClock.lastTickAt).coerceIn(0L, MAX_TICK_GAP_MS)
                        sessionClock.lastTickAt = now
                        val resting = restRemaining > 0
                        // A new drill starts its time from 0 here, in the same tick that sees it.
                        // Left to the drill-change effect (which runs a moment later), a tick in
                        // between judged the new drill on the old one's time: skipping the rest
                        // into the last drill ended the session at once (pilot 2026-11-27).
                        if (sessionClock.drillIndex != currentDrillIndex) {
                            sessionClock.drillIndex = currentDrillIndex
                            sessionClock.drillMs = (rejoinDrillSecs ?: 0) * 1000L
                        }
                        if (!isSessionPaused || resting) sessionClock.elapsedMs += dt
                        if (!isSessionPaused) {
                            sessionClock.drillMs += dt
                            drillTrack.activeMs += dt
                        }
                        elapsedSeconds = (sessionClock.elapsedMs / 1000L).toInt()
                        drillSeconds = (sessionClock.drillMs / 1000L).toInt()

                        checkWrist(now)

                        // The rest countdown also follows the real clock
                        var restTick = false
                        if (resting) {
                            sessionClock.restCarryMs += dt
                            while (sessionClock.restCarryMs >= 1000L && restRemaining > 0) {
                                sessionClock.restCarryMs -= 1000L
                                restRemaining -= 1
                                restTick = true
                            }
                        } else {
                            sessionClock.restCarryMs = 0L
                        }

                        // The checks and the phone update run once a second
                        if (now - lastSentAt < 1000L && !restTick) continue
                        lastSentAt = now
                        if (!phoneConnected) drillTrack.hadGap = true

                        val sess = activeSessionState

                        // Last drill's time is up: end on both devices at the same moment.
                        // The phone runs the same check; whichever is first tells the other.
                        if (sess != null && restRemaining == 0 && !isSessionPaused &&
                            currentDrillIndex >= sess.drills.size - 1
                        ) {
                            val lastMinutes = sess.drills.getOrNull(currentDrillIndex)?.durationMinutes ?: 0
                            if (lastMinutes > 0 && drillSeconds >= lastMinutes * 60) {
                                finishSession(tellPhone = true)
                                continue
                            }
                        }

                        // Locked well past the planned end: the phone's END was lost (it
                        // already shows home), so don't sit on the lock screen forever
                        if (sess != null && tracker.wearerLocked && trackingStartedAt > 0L) {
                            val plannedSecs = sess.drills.sumOf { maxOf(it.durationMinutes, 0) * 60 } +
                                sess.drills.dropLast(1).sumOf { it.restAfter }
                            val sinceStart = (SystemClock.elapsedRealtime() - trackingStartedAt) / 1000L
                            if (plannedSecs > 0 && sinceStart >= plannedSecs + LOCKED_PAST_PLAN_END_SECONDS) {
                                Log.d(TAG, "Locked past the planned end -> ending the session on the watch")
                                finishSession(tellPhone = true)
                                continue
                            }
                        }

                        // Phone gone: run the same drill durations and rests the phone uses,
                        // so both are on the same drill when they reconnect
                        val alone = !phoneConnected && SystemClock.elapsedRealtime() - phoneLostAt > PHONE_GONE_MS
                        if (restTick || restRemaining > 0) {
                            // Rest countdown runs either way (counted down above); with the phone
                            // there, the phone's RESUME starts the next drill, so only advance
                            // here when alone
                            if (restRemaining == 0 && alone && sess != null) {
                                triggerHapticVibration(context)
                                currentDrillIndex += 1
                                isSessionPaused = false
                            }
                        } else if (alone && sess != null) {
                            if (!isSessionPaused) {
                                val minutes = sess.drills.getOrNull(currentDrillIndex)?.durationMinutes ?: 0
                                // (The last drill is handled above for both cases)
                                if (minutes > 0 && drillSeconds >= minutes * 60 && currentDrillIndex < sess.drills.size - 1) {
                                    // The rest the coach set on this drill (0 = straight on)
                                    val rest = sess.drills.getOrNull(currentDrillIndex)?.restAfter ?: REST_BETWEEN_DRILLS_SECONDS
                                    if (rest > 0) {
                                        triggerRestStartAlert(context)
                                        restRemaining = rest
                                        isSessionPaused = true
                                    } else {
                                        triggerHapticVibration(context)
                                        currentDrillIndex += 1
                                    }
                                }
                            }
                        }

                        // Broadcast synchronized live telemetry packet to mobile phone
                        bleManager.sendLiveTelemetry(tracker.telemetryJson(elapsedSeconds, isSessionPaused, currentDrillIndex, activeSessionState?.sid, drillSecs = drillSeconds))
                    }
                }
            }

            fun parseDeviceName(rawInput: String?): String {
                if (rawInput.isNullOrBlank()) return "Mobile Phone"

                val parts = rawInput.split("|")
                val payload = parts[0].substringBefore(";acct=").trim()
                val btName = if (parts.size > 1) parts[1].trim() else ""

                var cleanPayload = payload
                    .replace("CONFIRMED:", "", ignoreCase = true)
                    .replace("CONFIRM:", "", ignoreCase = true)
                    .replace("UNLINK:", "", ignoreCase = true)
                    .trim()

                if (cleanPayload.equals("CONFIRMED", ignoreCase = true) ||
                    cleanPayload.equals("CONFIRM", ignoreCase = true) ||
                    cleanPayload.equals("UNLINK", ignoreCase = true) ||
                    cleanPayload.isBlank()
                ) {
                    cleanPayload = ""
                }

                return when {
                    cleanPayload.isNotBlank() -> cleanPayload
                    btName.isNotBlank() && !btName.equals("CONFIRMED", ignoreCase = true) -> btName
                    else -> "Mobile Phone"
                }
            }

            // Connect BLE callback to Compose state
            DisposableEffect(isLinked, hasBlePermissions, pairingCode) {
                if (hasBlePermissions) {
                    onGattPingReceived = {
                        runOnUiThread {
                            Log.d(TAG, "Watch received PING from mobile! Triggering haptic and visual confirmation.")
                            triggerHapticVibration(context)
                            lastPingMessage = "Phone Pinged Watch! Connected ✓"
                        }
                    }

                    if (!isLinked) {
                        onGattPairingConfirmed = { rawDeviceName ->
                            runOnUiThread {
                                pendingDeviceName = parseDeviceName(rawDeviceName)
                                pendingAccountId = parseAccountId(rawDeviceName)
                            }
                        }
                        onGattUnlinkRequested = null
                        onGattSessionStart = null
                        onGattSessionControl = null
                        isAdvertising = bleManager.startServer(
                            pairingCode = pairingCode,
                            onConfirmed = onGattPairingConfirmed,
                            onUnlinkRequested = null,
                            onSessionStart = null,
                            onSessionControl = null,
                            onPingReceived = onGattPingReceived,
                            watchId = watchUid
                        )
                    } else {
                        onGattPairingConfirmed = null
                        onGattUnlinkRequested = { rawDeviceName ->
                            runOnUiThread {
                                val parsed = parseDeviceName(rawDeviceName)
                                val finalName = if (parsed == "Mobile Phone") linkedDeviceName else parsed
                                pendingUnlinkDeviceName = finalName
                            }
                        }
                        onGattSessionStart = { payload ->
                            runOnUiThread { startSessionFromPayload(payload) }
                        }
                        onGattSessionControl = { command ->
                            runOnUiThread {
                                Log.d(TAG, "Watch received session control command: $command")
                                // Hand-over to the watch (see armedSession)
                                if (command.startsWith("ARM_SESSION:", ignoreCase = true)) {
                                    val armed = ArmedSession.fromCommand(command)
                                    if (armed == null) {
                                        Log.w(TAG, "Unreadable ARM_SESSION")
                                        return@runOnUiThread
                                    }
                                    if (activeSessionState != null) {
                                        Log.d(TAG, "ARM_SESSION while a session runs -> ignored")
                                        return@runOnUiThread
                                    }
                                    armedSession = armed
                                    handOverNotice = null
                                    prefs.edit().putString(KEY_ARMED_SESSION, armed.toJson()).apply()
                                    armed.wearer?.let {
                                        wearer = it
                                        prefs.edit().putString(KEY_WEARER, it.toJson()).apply()
                                    }
                                    try {
                                        CheckedInSession.fromJson(JSONObject(armed.startPayload.substring(armed.startPayload.indexOf('{'))))
                                            ?.takeIf { it.venue != null || it.atHome }
                                            ?.let { saveCheckedInSession(it) }
                                    } catch (_: Exception) {}
                                    wakeScreen()
                                    triggerHapticVibration(context)
                                    lastPingMessage = "Ready · start from the watch"
                                    return@runOnUiThread
                                }
                                if (command == "DISARM") {
                                    disarmSession("Hand-over cancelled on the phone")
                                    return@runOnUiThread
                                }
                                // Wearer commands don't touch the drill / rest state
                                when {
                                    command.startsWith("WEARER=", ignoreCase = true) -> {
                                        WearerIdentity.fromCommand(command)?.let {
                                            wearer = it
                                            prefs.edit().putString(KEY_WEARER, it.toJson()).apply()
                                        }
                                        return@runOnUiThread
                                    }
                                    command == "VERIFY_REQ" -> {
                                        // Identity check: keep counting, ask to confirm on the phone
                                        if (activeSessionState != null) identityCheckId += 1
                                        return@runOnUiThread
                                    }
                                    command == "VERIFY_COACH" -> {
                                        awaitingCoach = true
                                        return@runOnUiThread
                                    }
                                    command == "VERIFY_END" -> {
                                        // The phone closed the check (time ran out)
                                        identityCheckSeconds = 0
                                        return@runOnUiThread
                                    }
                                    command == "VERIFY_OK" -> {
                                        identityCheckSeconds = 0
                                        awaitingCoach = false
                                        // Unlock only while it's actually on a wrist
                                        if (tracker.onBody) {
                                            tracker.unlockWearer()
                                            triggerHapticVibration(context)
                                            lastPingMessage = "Verified ✓"
                                        }
                                        return@runOnUiThread
                                    }
                                }
                                restRemaining = 0
                                if (command.startsWith("SESSION_INFO:", ignoreCase = true)) {
                                    // Check-in (details) or cancelled check-in (empty)
                                    val info = try {
                                        command.indexOf('{').takeIf { it >= 0 }
                                            ?.let { CheckedInSession.fromJson(JSONObject(command.substring(it))) }
                                    } catch (_: Exception) { null }
                                    saveCheckedInSession(info)
                                    return@runOnUiThread
                                }
                                if (command.startsWith("WORKOUT:", ignoreCase = true)) {
                                    val w = parseWorkoutCommand(command) ?: return@runOnUiThread
                                    val total = maxOf(activeSessionState?.drills?.size ?: 0, activeSessionState?.drillCount ?: 0, 1)
                                    currentDrillIndex = w.index.coerceIn(0, total - 1)
                                    workoutCommand = w.copy(index = currentDrillIndex)
                                    w.category?.let { currentZone = it }
                                    if (w.metrics.isNotEmpty()) zoneMetrics = w.metrics
                                    return@runOnUiThread
                                }
                                if (command.startsWith("REST:")) {
                                    // Rest between drills (the phone leads it): paused, shown as resting
                                    val alreadyResting = isSessionPaused && restRemaining > 0
                                    restRemaining = command.substringAfter(":").toIntOrNull()?.coerceAtLeast(0) ?: REST_BETWEEN_DRILLS_SECONDS
                                    isSessionPaused = true
                                    // Only when rest starts, not when the phone resends it after a reconnect
                                    if (!alreadyResting && restRemaining > 0) triggerRestStartAlert(context)
                                    return@runOnUiThread
                                }
                                when (command) {
                                    "PAUSE" -> { isSessionPaused = true; restRemaining = 0 }
                                    "RESUME" -> { isSessionPaused = false; restRemaining = 0 }
                                    "END" -> finishSession(tellPhone = false)
                                    "NEXT_DRILL" -> {
                                        val total = maxOf(activeSessionState?.drills?.size ?: 0, activeSessionState?.drillCount ?: 0, 1)
                                        currentDrillIndex = (currentDrillIndex + 1) % total
                                    }
                                    "PREV_DRILL" -> {
                                        if (currentDrillIndex > 0) currentDrillIndex -= 1
                                    }
                                    "GEOFENCE_WARN" -> {
                                        triggerGeofenceWarningVibration(context)
                                        lastPingMessage = "⚠ Don't leave the venue! Return now"
                                    }
                                    else -> if (command.contains(":")) {
                                        val u = parseZoneCommand(command)
                                        val drills = activeSessionState?.drills ?: emptyList()
                                        val needsSnap = u.zone != null && !drills.getOrNull(currentDrillIndex)?.category.equals(u.zone, ignoreCase = true)
                                        val snap = if (needsSnap) drills.indexOfFirst { it.category.equals(u.zone, ignoreCase = true) }.takeIf { it >= 0 } else null
                                        (u.index ?: snap)?.let { currentDrillIndex = it }
                                        if (u.zone != null) currentZone = u.zone
                                        if (u.metrics.isNotEmpty()) zoneMetrics = u.metrics
                                    }
                                }
                            }
                        }
                        isAdvertising = bleManager.startServer(
                            pairingCode = pairingCode,
                            onConfirmed = null,
                            onUnlinkRequested = onGattUnlinkRequested,
                            onSessionStart = onGattSessionStart,
                            onSessionControl = onGattSessionControl,
                            onPingReceived = onGattPingReceived,
                            // Linked: only the owning account may pair again (e.g. from a new phone)
                            onDrillAck = { sid, index ->
                                runOnUiThread { recordStore.ack(sid, index) }
                            },
                            onPairingWhileLinked = { raw ->
                                runOnUiThread {
                                    val requester = parseAccountId(raw)
                                    val owner = prefs.getString(KEY_LINKED_ACCOUNT, null)
                                    if (requester != null && requester == owner) {
                                        Log.d(TAG, "Re-pair from the owning account -> accepted")
                                        val name = parseDeviceName(raw)
                                        if (name != "Mobile Phone") {
                                            prefs.edit().putString(KEY_LINKED_DEVICE_NAME, name).apply()
                                            linkedDeviceName = name
                                        }
                                        bleManager.sendPairingResponseStr("ACCEPTED")
                                    } else {
                                        Log.d(TAG, "Pairing request from another account -> IN_USE")
                                        bleManager.sendPairingResponseStr("IN_USE")
                                    }
                                }
                            },
                            watchId = watchUid
                        )
                    }
                }

                onDispose {
                    // Do not tear down GATT server on compose recompositions; server is cleanly stopped in onDestroy()
                }
            }

            Box(modifier = Modifier.fillMaxSize()) {
                if (!isLinked) {
                    DeviceLinkPromptScreen(
                        pairingCode = pairingCode,
                        isAdvertising = isAdvertising,
                        pendingDeviceName = pendingDeviceName,
                        onAcceptLink = {
                            val deviceToSave = pendingDeviceName ?: "Mobile Phone"
                            bleManager.sendPairingResponse(true)
                            prefs.edit()
                                .putBoolean(KEY_IS_LINKED, true)
                                .putString(KEY_LINKED_DEVICE_NAME, deviceToSave)
                                .putString(KEY_LINKED_ACCOUNT, pendingAccountId)
                                .apply()
                            linkedDeviceName = deviceToSave
                            isLinked = true
                            pendingDeviceName = null
                            pendingAccountId = null
                        },
                        onDeclineLink = {
                            bleManager.sendPairingResponse(false)
                            pendingDeviceName = null
                            pendingAccountId = null
                        }
                    )
                } else if (activeSessionState != null && isCountdownActive) {
                    SessionCountdownScreen(
                        sessionData = activeSessionState!!,
                        countdownSeconds = countdownSeconds,
                        onSkipCountdown = {
                            triggerHapticVibration(context)
                            isCountdownActive = false
                        }
                    )
                } else if (activeSessionState != null && tracker.wearerLocked) {
                    WearerLockedScreen(
                        wearer = wearer,
                        reason = tracker.lockWhy,
                        onWrist = tracker.onBody,
                        phoneConnected = phoneConnected,
                        awaitingCoach = awaitingCoach,
                        // Ended on the watch before the plan finished (tells the phone)
                        onEndSession = { finishSession(tellPhone = true, endedEarly = true) }
                    )
                } else if (activeSessionState != null) {
                    ActiveSessionTrackingScreen(
                        sessionData = activeSessionState!!,
                        currentDrillIndex = currentDrillIndex,
                        elapsedSeconds = { elapsedSeconds },
                        drillSeconds = { drillSeconds },
                        tracker = tracker,
                        wearer = wearer,
                        zone = currentZone,
                        zoneMetrics = zoneMetrics,
                        isPaused = isSessionPaused,
                        phoneConnected = phoneConnected,
                        restRemaining = restRemaining,
                        onTogglePause = {
                            isSessionPaused = !isSessionPaused
                            if (!isSessionPaused) restRemaining = 0
                        },
                        onNextDrill = {
                            val totalDrills = maxOf(activeSessionState?.drills?.size ?: 0, activeSessionState?.drillCount ?: 0, 1)
                            if (currentDrillIndex < totalDrills - 1) {
                                currentDrillIndex += 1
                                // Next Drill during the rest starts that drill now: sensors back
                                // on at once (the phone, following, ends its rest and resumes too).
                                // Left paused, the drill ran unmeasured.
                                if (restRemaining > 0) {
                                    restRemaining = 0
                                    isSessionPaused = false
                                }
                            } else {
                                finishSession(tellPhone = true)
                            }
                        },
                        // End pressed on the watch before the plan finished
                        onEndSession = { finishSession(tellPhone = true, endedEarly = true) }
                    )
                } else if (completedTitle == null && !syncLater && recordStore.pendingCount > 0 && phoneConnected) {
                    SessionCompleteScreen(
                        title = "Recorded while out of range",
                        pendingDrills = recordStore.pendingCount,
                        syncTotal = maxOf(syncTotal, recordStore.pendingCount),
                        phoneConnected = true,
                        onDismiss = { syncLater = true }
                    )
                } else if (completedTitle != null) {
                    SessionCompleteScreen(
                        title = completedTitle!!,
                        pendingDrills = recordStore.pendingCount,
                        syncTotal = syncTotal,
                        phoneConnected = phoneConnected,
                        onDismiss = { completedTitle = null }
                    )
                } else {
                    Home(
                        linkedDeviceName = linkedDeviceName,
                        pendingDrillRecords = recordStore.pendingCount,
                        checkedInSession = checkedInSession,
                        armedTitle = armedSession?.title,
                        handOverNotice = if (armedSession == null) handOverNotice else null,
                        armedStartsAt = armedSession?.startsAt ?: 0L,
                        onStartArmed = {
                            val armed = armedSession
                            if (armed != null && System.currentTimeMillis() >= armed.startsAt) {
                                startSessionFromPayload(armed.startPayload)
                            }
                        },
                        phoneConnected = phoneConnected,
                        pendingUnlinkDeviceName = pendingUnlinkDeviceName,
                        pairingCode = pairingCode,
                        unlinkMode = when {
                            !unlinkFromWatch -> "phone_request"
                            unlinkWaitingForPhone -> "watch_waiting"
                            phoneConnected && !unlinkPhoneNoAnswer -> "watch_ask_phone"
                            else -> "watch_only"
                        },
                        onConfirmUnlink = {
                            when {
                                // The phone asked: answer it and unlink
                                !unlinkFromWatch -> {
                                    bleManager.sendPairingResponse(true)
                                    unlinkWatch(noticeForPhone = false)
                                }
                                // Started on the watch with the phone in range: ask the phone
                                phoneConnected && !unlinkPhoneNoAnswer -> {
                                    bleManager.sendDrillRecord(
                                        org.json.JSONObject().put("t", "unlink_request").put("name", linkedDeviceName).toString()
                                    )
                                    unlinkWaitingForPhone = true
                                }
                                // Phone away (or no answer): unlink here, tell the phone later
                                else -> unlinkWatch(noticeForPhone = true)
                            }
                        },
                        onCancelUnlink = {
                            if (!unlinkFromWatch) bleManager.sendPairingResponse(false)
                            pendingUnlinkDeviceName = null
                            unlinkFromWatch = false
                            unlinkWaitingForPhone = false
                            unlinkPhoneNoAnswer = false
                        },
                        onRequestUnlink = {
                            unlinkFromWatch = true
                            unlinkPhoneNoAnswer = false
                            pendingUnlinkDeviceName = linkedDeviceName
                        }
                    )
                }

                // Identity check banner (the watch keeps counting underneath)
                if (identityCheckSeconds > 0 && activeSessionState != null && !tracker.wearerLocked) {
                    IdentityCheckBanner(
                        secondsLeft = identityCheckSeconds,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }

                // Global Ping Received Alert Banner Overlay
                if (lastPingMessage != null) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 22.dp)
                            .fillMaxWidth(0.90f)
                            .clip(RoundedCornerShape(14.dp))
                            // Warnings in amber, confirmations in green
                            .background(if (lastPingMessage!!.startsWith("⚠")) Color(0xFF7A4F00) else Color(0xFF005A36))
                            .padding(vertical = 6.dp, horizontal = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = lastPingMessage!!,
                            color = Color.White,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        }
    }

    private fun checkAndRequestPermissions() {
        val needed = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            needed.add(Manifest.permission.ACTIVITY_RECOGNITION)
        }
        needed.add(Manifest.permission.BODY_SENSORS)

        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        hasBlePermissions = checkBlePermissions()
        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        } else {
            hasPermissions = true
        }
    }

    override fun onDestroy() {
        screenHandler.removeCallbacks(dimRunnable)
        setAppAwake(linked = false, running = false)
        super.onDestroy()
        bleManager.stopServer()
    }
}

@Composable
fun SessionCountdownScreen(
    sessionData: ActiveSessionData,
    countdownSeconds: Int,
    onSkipCountdown: () -> Unit
) {
    val emeraldGreen = Color(0xFF00A86B)
    val darkMutedGreen = Color(0xFF0B2B22)

    val listState = rememberTransformingLazyColumnState()
    val firstDrill = sessionData.drills.firstOrNull() ?: DrillItem("Training Drill", 10, "General")
    val countText = if (countdownSeconds > 0) "$countdownSeconds" else "GO!"

    AppScaffold {
        ScreenScaffold(
            timeText = { TimeText() },
            scrollState = listState
        ) { paddingValues ->
            TransformingLazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Header
                item {
                    ListHeader {
                        Text(
                            text = "Get Ready!",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center
                        )
                    }
                }

                // Countdown Number Card
                item {
                    Spacer(modifier = Modifier.height(2.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.85f)
                            .height(64.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(darkMutedGreen),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = countText,
                            style = MaterialTheme.typography.displayMedium,
                            fontWeight = FontWeight.ExtraBold,
                            color = emeraldGreen
                        )
                    }
                }

                // Session & Drill Details
                item {
                    Text(
                        text = sessionData.title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        textAlign = TextAlign.Center
                    )
                }

                item {
                    Text(
                        text = "1st Drill: ${firstDrill.name} (${firstDrill.durationMinutes}m)",
                        style = MaterialTheme.typography.bodyExtraSmall,
                        color = emeraldGreen,
                        textAlign = TextAlign.Center
                    )
                }

                item {
                    Text(
                        text = "Adjust wristband. Tracking starting shortly…",
                        style = MaterialTheme.typography.bodyExtraSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp)
                    )
                }

                // Action Button: Start Immediately
                item {
                    Button(
                        onClick = onSkipCountdown,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = emeraldGreen,
                            contentColor = Color.White
                        ),
                        modifier = Modifier.fillMaxWidth(0.9f)
                    ) {
                        Text(
                            text = "Start Now ▶",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ActiveSessionTrackingScreen(
    sessionData: ActiveSessionData,
    currentDrillIndex: Int,
    // Readers, not values: only the cards that show them recompose when they change
    elapsedSeconds: () -> Int,
    drillSeconds: () -> Int,
    tracker: WorkoutSensorTracker,
    wearer: WearerIdentity?,
    zone: String?,
    zoneMetrics: Set<String>,
    isPaused: Boolean,
    phoneConnected: Boolean,
    restRemaining: Int,
    onTogglePause: () -> Unit,
    onNextDrill: () -> Unit,
    onEndSession: () -> Unit
) {
    val emeraldGreen = Color(0xFF00A86B)
    val darkMutedGreen = Color(0xFF0B2B22)
    val darkRedBg = Color(0xFF3A1C1C)
    val brightRedText = Color(0xFFFF6B6B)
    val amberWarning = Color(0xFFFFB300)
    val restBlue = Color(0xFF60A5FA)
    // Paused for the rest between drills (not a pause the athlete chose)
    val isResting = isPaused && restRemaining > 0
    val restClock = String.format(java.util.Locale.US, "%d:%02d", restRemaining / 60, restRemaining % 60)

    val listState = rememberTransformingLazyColumnState()

    val totalDrills = sessionData.drills.size.coerceAtLeast(sessionData.drillCount).coerceAtLeast(1)
    val safeDrillIndex = currentDrillIndex.coerceIn(0, totalDrills - 1)
    val currentDrill = sessionData.drills.getOrNull(safeDrillIndex) ?: DrillItem(
        name = "General Training Drill",
        durationMinutes = (sessionData.totalDurationMinutes / totalDrills).coerceAtLeast(5),
        category = "General"
    )

    val tracked = zoneMetrics.filter { it in listOf("steps", "distance", "jumps", "reps", "heartRate") }
    fun show(k: String) = tracked.isEmpty() || k in tracked
    // Steps/distance aren't counted in stationary workouts, so don't show a frozen number
    fun showMovement(k: String) = show(k) && tracker.profile.tracksSteps

    AppScaffold {
        ScreenScaffold(
            timeText = { TimeText() },
            scrollState = listState
        ) { paddingValues ->
            TransformingLazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Header - Session Title
                item {
                    ListHeader {
                        Text(
                            text = sessionData.title,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center
                        )
                    }
                }

                // Whose watch this is, so the coach can check it at a glance
                if (wearer != null) {
                    item { WearerBadge(wearer) }
                }

                // Recording / Movement Status Badge
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.92f)
                            .height(28.dp)
                            .clip(CircleShape)
                            .background(
                                if (isResting) Color(0xFF172554)
                                else if (isPaused) Color(0xFF332A00)
                                else if (!tracker.onBody) darkRedBg
                                else if (tracker.isMoving) darkMutedGreen
                                else Color(0xFF1E242B)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (isResting) "⏸ RESTING · $restClock"
                                   else if (isPaused) "⏸ PAUSED"
                                   else if (!tracker.onBody) "⚠ WEAR WATCH ON WRIST"
                                   else if (tracker.isMoving) "● ACTIVE MOVEMENT"
                                   else "○ STATIONARY (TABLE)",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = if (isResting) restBlue
                                    else if (isPaused) amberWarning
                                    else if (!tracker.onBody) brightRedText
                                    else if (tracker.isMoving) emeraldGreen
                                    else Color(0xFF94A3B8)
                        )
                    }
                }

                // Resting: what's next, and start it now without waiting out the rest
                val nextDrill = sessionData.drills.getOrNull(safeDrillIndex + 1)
                if (isResting && safeDrillIndex < totalDrills - 1) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.88f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF172554))
                                .padding(vertical = 8.dp, horizontal = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "UP NEXT · DRILL ${safeDrillIndex + 2} OF $totalDrills",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = restBlue
                                )
                                Text(
                                    text = nextDrill?.name ?: "Next drill",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White,
                                    textAlign = TextAlign.Center
                                )
                                if (nextDrill != null) {
                                    Text(
                                        text = "${nextDrill.category} · ${nextDrill.durationMinutes}m",
                                        style = MaterialTheme.typography.bodyExtraSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                    item {
                        // Same as Next Drill during the rest: the drill starts now on the watch,
                        // and the phone, following it, ends its rest and resumes too
                        Button(
                            onClick = onNextDrill,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = restBlue,
                                contentColor = Color(0xFF0B1220)
                            ),
                            modifier = Modifier.fillMaxWidth(0.9f)
                        ) {
                            Text(
                                text = "▶ Skip rest · start now",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                // Live Metrics Card (filtered by synced zone)
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.88f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFF161E2E))
                            .padding(vertical = 6.dp, horizontal = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.SpaceAround,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            if (showMovement("steps")) MetricCell("${tracker.steps}", "STEPS", emeraldGreen)
                            if (showMovement("distance")) MetricCell("${tracker.meters.toInt()}m", "DISTANCE", Color(0xFF38BDF8))
                            if (show("reps") && tracker.profile.countReps) MetricCell("${tracker.reps}", "REPS", Color(0xFFFB923C))
                            // Jumps are counted here on the watch (not the phone)
                            if (show("jumps") && tracker.profile.detectJumps) MetricCell("${tracker.jumps}", "JUMPS", Color(0xFFC084FC))
                            // Plyometrics: average ground contact of the counted rebounds (lower = more reactive)
                            if (show("jumps") && tracker.profile.plyometric) MetricCell(
                                tracker.groundContactMs.let { if (it > 0) "$it" else "--" }, "CONTACT ms", Color(0xFFF472B6)
                            )
                            if (tracked.contains("heartRate")) MetricCell(tracker.heartRate.let { if (it > 0) "$it" else "--" }, "BPM", Color(0xFFFF6B6B))
                        }
                    }
                }

                // Current Active Drill Card
                item {
                    Spacer(modifier = Modifier.height(2.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.88f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(darkMutedGreen)
                            .padding(vertical = 8.dp, horizontal = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "DRILL ${safeDrillIndex + 1} OF $totalDrills",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = currentDrill.name,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                textAlign = TextAlign.Center
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "[${zone ?: currentDrill.category}]",
                                    style = MaterialTheme.typography.bodyExtraSmall,
                                    color = emeraldGreen,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
//                                    text = "• ${currentDrill.durationMinutes}m",
                                    text = "• ${drillSeconds().let { String.format(java.util.Locale.US, "%02d:%02d", it / 60, it % 60) }} / ${currentDrill.durationMinutes}m",
                                    style = MaterialTheme.typography.bodyExtraSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                text = "${tracker.profile.label}: ${tracker.activeSensors.joinToString(" · ").ifEmpty { "no sensors" }}",
                                style = MaterialTheme.typography.bodyExtraSmall,
                                color = Color(0xFF94A3B8),
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }

                // Timer & Sensor Status Display
                item {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(vertical = 2.dp)
                    ) {
                        Text(
                            text = elapsedSeconds().let { String.format(java.util.Locale.US, "%02d:%02d", it / 60, it % 60) },
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.ExtraBold,
                            color = if (isResting) restBlue else if (isPaused) amberWarning else Color.White
                        )
                        Text(
                            text = when {
                                isResting -> "Rest mode · next drill in $restClock"
                                !phoneConnected -> "Phone out of range · saving on watch"
                                isPaused -> "Session Paused"
                                else -> "Synced with Phone"
                            },
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = if (isResting) restBlue else if (isPaused) amberWarning else emeraldGreen
                        )
                    }
                }

                // Pause / Resume Button. Not while resting: "Resume" there restarted the drill
                // just finished; Skip rest (above) starts the next one
                if (!isResting) item {
                    Button(
                        onClick = onTogglePause,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isPaused) emeraldGreen else Color(0xFF2E2E2E),
                            contentColor = Color.White
                        ),
                        modifier = Modifier.fillMaxWidth(0.9f)
                    ) {
                        Text(
                            text = if (isPaused) "▶ Resume Session" else "⏸ Pause Tracking",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // Next Drill / Complete Drill Button (resting: Skip rest above does this)
                if (!isResting || safeDrillIndex >= totalDrills - 1) item {
                    if (safeDrillIndex < totalDrills - 1) {
                        Button(
                            onClick = onNextDrill,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = emeraldGreen,
                                contentColor = Color.White
                            ),
                            modifier = Modifier.fillMaxWidth(0.9f)
                        ) {
                            Text(
                                text = "▶ Next Drill",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    } else {
                        Button(
                            onClick = onEndSession,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = emeraldGreen,
                                contentColor = Color.White
                            ),
                            modifier = Modifier.fillMaxWidth(0.9f)
                        ) {
                            Text(
                                text = "🏁 Complete Session",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                // The drills still to come, in order (the next one first)
                val upcoming = sessionData.drills.withIndex().filter { it.index > safeDrillIndex }
                if (upcoming.isNotEmpty()) {
                    item {
                        Text(
                            text = "UPCOMING DRILLS",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp)
                        )
                    }
                    items(upcoming.size) { i ->
                        val (index, drill) = upcoming[i]
                        UpcomingDrillRow(
                            number = index + 1,
                            drill = drill,
                            isNext = i == 0,
                            accent = if (isResting) restBlue else emeraldGreen
                        )
                    }
                }

                // Stop / End Session Button
                item {
                    Button(
                        onClick = onEndSession,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = darkRedBg,
                            contentColor = brightRedText
                        ),
                        modifier = Modifier.fillMaxWidth(0.9f)
                    ) {
                        Text(
                            text = "End Session",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

/** One drill still to come: its number in the session, name, type and time. */
@Composable
fun UpcomingDrillRow(number: Int, drill: DrillItem, isNext: Boolean, accent: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth(0.88f)
            .clip(RoundedCornerShape(10.dp))
            .background(if (isNext) Color(0xFF1B2638) else Color(0xFF12171F))
            .padding(vertical = 6.dp, horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "$number",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = if (isNext) accent else Color(0xFF64748B)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = drill.name,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (isNext) FontWeight.Bold else FontWeight.Normal,
                color = Color.White,
                maxLines = 2
            )
            Text(
                text = "${drill.category} · ${drill.durationMinutes}m",
                style = MaterialTheme.typography.bodyExtraSmall,
                color = Color(0xFF94A3B8),
                maxLines = 1
            )
        }
    }
}

@Composable
fun SessionCompleteScreen(
    title: String,
    pendingDrills: Int,
    syncTotal: Int,
    phoneConnected: Boolean,
    onDismiss: () -> Unit
) {
    val emeraldGreen = Color(0xFF00A86B)
    val amber = Color(0xFFFFB300)
    val sky = Color(0xFF38BDF8)
    val listState = rememberTransformingLazyColumnState()

    val syncing = pendingDrills > 0
    val synced = (syncTotal - pendingDrills).coerceAtLeast(0)
    val progress = if (syncTotal > 0) synced.toFloat() / syncTotal else 1f

    AppScaffold {
        ScreenScaffold(timeText = { TimeText() }, scrollState = listState) { paddingValues ->
            TransformingLazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                item {
                    Text(
                        text = when {
                            !syncing -> "🏁"
                            phoneConnected -> "🔄"
                            else -> "📡"
                        },
                        style = MaterialTheme.typography.displaySmall,
                        textAlign = TextAlign.Center
                    )
                }
                item {
                    Text(
                        text = when {
                            !syncing && syncTotal > 0 -> "All drills synced"
                            !syncing -> "Session complete"
                            phoneConnected -> "Syncing to phone…"
                            else -> "Bring watch near phone"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = when {
                            !syncing -> emeraldGreen
                            phoneConnected -> sky
                            else -> amber
                        },
                        textAlign = TextAlign.Center
                    )
                }
                item {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 16.dp)
                    )
                }

                // Sync progress (only when drills were recorded while out of range)
                if (syncTotal > 0) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.75f)
                                .height(8.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFF1E293B))
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(progress)
                                    .height(8.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(if (syncing) sky else emeraldGreen)
                            )
                        }
                    }
                    item {
                        Text(
                            text = "$synced / $syncTotal drills synced",
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center
                        )
                    }
                }

                item {
                    Text(
                        text = when {
                            syncing && !phoneConnected ->
                                "These drills were recorded while out of range. Keep the app open near your phone."
                            syncing -> "Keep the watch near your phone"
                            else -> "Check your phone to save it"
                        },
                        style = MaterialTheme.typography.bodyExtraSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 14.dp)
                    )
                }
                item {
                    Button(
                        onClick = onDismiss,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (syncing) Color(0xFF2E2E2E) else emeraldGreen,
                            contentColor = Color.White
                        ),
                        modifier = Modifier.fillMaxWidth(0.8f)
                    ) {
                        Text(
                            // Leaving keeps the drills; they still sync from the home screen
                            text = if (syncing) "Sync later" else "Done",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun Home(
    linkedDeviceName: String = "Mobile Phone",
    pendingUnlinkDeviceName: String? = null,
    pairingCode: String = "849215",
    pendingDrillRecords: Int = 0,
    checkedInSession: CheckedInSession? = null,
    /** Session handed to the watch: started from here (null = none) */
    armedTitle: String? = null,
    /** When it may start (epoch ms; 0 = now) */
    armedStartsAt: Long = 0L,
    /** Why the last hand-over was cancelled (null = nothing to say) */
    handOverNotice: String? = null,
    onStartArmed: () -> Unit = {},
    phoneConnected: Boolean = false,
    /** phone_request | watch_ask_phone | watch_waiting | watch_only */
    unlinkMode: String = "phone_request",
    onConfirmUnlink: () -> Unit = {},
    onCancelUnlink: () -> Unit = {},
    onRequestUnlink: () -> Unit = {}
) {
    val emeraldGreen = Color(0xFF00A86B)
    val darkMutedGreen = Color(0xFF0B2B22)
    val darkRedBg = Color(0xFF3A1C1C)
    val brightRedText = Color(0xFFFF6B6B)

    val listState = rememberTransformingLazyColumnState()
    val displayUnlinkDevice = pendingUnlinkDeviceName ?: linkedDeviceName

    AppScaffold {
        ScreenScaffold(
            timeText = { TimeText() },
            scrollState = listState
        ) { paddingValues ->
            TransformingLazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                if (pendingUnlinkDeviceName != null) {
                    // --- UNLINK CONFIRMATION PROMPT WITH LINKED DEVICE INFO ---
                    item {
                        ListHeader {
                            Text(
                                text = "Unlink Request",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onBackground,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.9f)
                                .height(26.dp)
                                .clip(CircleShape)
                                .background(darkRedBg),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "⚠ Confirm Unlinking",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = brightRedText
                            )
                        }
                    }

                    // Linked Device & Watch Information Box
                    item {
                        Spacer(modifier = Modifier.height(2.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.88f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(darkMutedGreen)
                                .padding(vertical = 8.dp, horizontal = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "LINKED DEVICE",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = displayUnlinkDevice,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = brightRedText,
                                    textAlign = TextAlign.Center
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Text(
                                    text = "Watch #$pairingCode",
                                    style = MaterialTheme.typography.bodyExtraSmall,
                                    color = emeraldGreen,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }

                    item {
                        Text(
                            text = when (unlinkMode) {
                                "watch_ask_phone" -> "Unlink $displayUnlinkDevice? Your phone will be asked to confirm."
                                "watch_waiting" -> "Confirm the unlink on your phone…"
                                "watch_only" -> "Phone not connected. Unlink on the watch only? Your phone is told the next time they connect."
                                else -> "Unlink $displayUnlinkDevice from Watch #$pairingCode and return to pairing mode?"
                            },
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                        )
                    }

                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(0.9f),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Button(
                                onClick = onCancelUnlink,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF2A2A2A),
                                    contentColor = Color.White
                                ),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = "Cancel",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }

                            if (unlinkMode != "watch_waiting") {
                                Button(
                                    onClick = onConfirmUnlink,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = Color(0xFFB71C1C),
                                        contentColor = Color.White
                                    ),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text(
                                        text = if (unlinkMode == "watch_only") "Watch only" else "Unlink",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                } else {
                    // --- STANDARD HOME CONTENT ---
                    item {
                        ListHeader {
                            Text(
                                text = "SmartLit",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onBackground,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    item {
                        Text(
                            text = checkedInSession?.let { s ->
                                listOfNotNull(s.title, s.startTime).joinToString(" · ")
                            } ?: "No session checked in",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (checkedInSession != null) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = if (checkedInSession != null) FontWeight.SemiBold else FontWeight.Normal,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp)
                        )
                    }

                    item {
                        Text(
                            text = when {
                                checkedInSession == null -> "Check in on your phone"
                                checkedInSession.atHome -> "🏠 At Home"
                                else -> "📍 ${checkedInSession.venue ?: "Venue"}"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (checkedInSession != null) emeraldGreen else MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 12.dp)
                        )
                    }

                    if (armedTitle == null && handOverNotice != null) {
                        item {
                            Text(
                                text = handOverNotice,
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFFFFC107),
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(horizontal = 14.dp)
                            )
                        }
                    }
                    if (armedTitle != null) {
                        item {
                            // Ticks so the button unlocks at the start time by itself
                            var nowMs by remember { mutableStateOf(System.currentTimeMillis()) }
                            LaunchedEffect(armedStartsAt) {
                                while (System.currentTimeMillis() < armedStartsAt) {
                                    delay(1000L)
                                    nowMs = System.currentTimeMillis()
                                }
                                nowMs = System.currentTimeMillis()
                            }
                            val canStart = nowMs >= armedStartsAt
                            Button(
                                onClick = onStartArmed,
                                enabled = canStart,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = emeraldGreen,
                                    contentColor = Color.White
                                ),
                                modifier = Modifier.fillMaxWidth(0.9f)
                            ) {
                                Text(
                                    text = if (canStart) "▶ Start session"
                                    else "Starts " + java.text.SimpleDateFormat("h:mm a", java.util.Locale.US)
                                        .format(java.util.Date(armedStartsAt)),
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }

                    item {
                        Spacer(modifier = Modifier.height(2.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.85f)
                                .height(32.dp)
                                .clip(CircleShape)
                                .background(darkMutedGreen),
                            contentAlignment = Alignment.Center
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Text(
                                    text = "✓ ",
                                    color = emeraldGreen,
                                    style = MaterialTheme.typography.titleMedium
                                )
                                Text(
                                    text = "Ready to record",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = emeraldGreen
                                )
                            }
                        }
                    }

                    item {
                        Text(
                            text = if (pendingDrillRecords > 0)
                                "$pendingDrillRecords drill${if (pendingDrillRecords == 1) "" else "s"} waiting to sync · bring phone near"
                            else "Starts from your phone",
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 16.dp)
                        )
                    }

                    item {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Linked: $linkedDeviceName (Watch #$pairingCode)",
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = emeraldGreen,
                            textAlign = TextAlign.Center
                        )
                    }

                    // Live Bluetooth link with the phone (no internet needed)
                    item {
                        Text(
                            text = if (phoneConnected) "● Connected to phone" else "○ Phone not connected",
                            style = MaterialTheme.typography.bodyExtraSmall,
                            fontWeight = FontWeight.Bold,
                            color = if (phoneConnected) emeraldGreen else Color(0xFFFFB300),
                            textAlign = TextAlign.Center
                        )
                    }

                    item {
                        CompactButton(
                            onClick = onRequestUnlink,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xFF2A1515),
                                contentColor = Color(0xFFFF8A80)
                            )
                        ) {
                            Text(
                                text = "Unlink",
                                style = MaterialTheme.typography.bodyExtraSmall
                            )
                        }
                    }
                }
            }
        }
    }
}
