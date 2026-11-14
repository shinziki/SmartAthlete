package com.example.smartathlete.presentation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
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
    val profile: String? = null
)

data class ActiveSessionData(
    /** Run id from the phone; echoed in telemetry so the phone can drop packets from older runs */
    val sid: String? = null,
    val title: String = "Training Session",
    val drillCount: Int = 0,
    val totalDurationMinutes: Int = 0,
    val drills: List<DrillItem> = emptyList()
)

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

/** The drill being recorded, so the watch can save it if the phone missed part of it. */
class DrillTrack {
    var sid: String? = null
    var index = 0
    var name = ""
    var startSecs = 0
    /** The phone was out of range at some point during this drill */
    var hadGap = false
}

/** Matches the phone's rest between drills, used while the watch runs the plan alone. */
private const val REST_BETWEEN_DRILLS_SECONDS = 180
/** How long the phone must be gone before the watch follows the session plan itself. */
private const val PHONE_GONE_MS = 10_000L

// Current drill types, then the ones older phone builds send
private val ZONE_NAMES = listOf(
    "Warm-up", "Running", "Strength", "Jumping", "Agility", "Cool-down",
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
                                profile = itemObj.optString("profile").takeIf { it.isNotBlank() }
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
            var isSessionPaused by remember { mutableStateOf(false) }

            // The workout the phone says is running; null until the first WORKOUT command
            var workoutCommand by remember { mutableStateOf<WorkoutCommand?>(null) }

            // Sensors for the current workout: the phone's WORKOUT command wins for its drill;
            // otherwise use the drill's own profile (the athlete advanced from the wrist)
            val currentDrill = activeSessionState?.drills?.getOrNull(currentDrillIndex)
            val currentProfile = workoutCommand?.takeIf { it.index == currentDrillIndex }?.profile
                ?: SensorProfile.fromKey(currentDrill?.profile)
                ?: SensorProfile.forCategory(currentDrill?.category ?: currentZone)

            val tracker = remember { WorkoutSensorTracker(sensorManager) }
            val isTracking = activeSessionState != null && !isCountdownActive

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
            fun finishSession(tellPhone: Boolean) {
                val sess = activeSessionState ?: return
                if (tellPhone) {
                    completedPacket = tracker.telemetryJson(
                        elapsedSeconds, true, currentDrillIndex, sess.sid, completed = true
                    )
                }
                completedTitle = sess.title
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

            // Fresh totals when a session's countdown finishes
            DisposableEffect(activeSessionState, isCountdownActive) {
                if (isTracking) {
                    tracker.reset()
                    isSessionPaused = false
                    elapsedSeconds = 0
                }
                onDispose {}
            }

            // Switch sensors whenever the workout's profile changes; totals carry over
            DisposableEffect(isTracking, currentProfile) {
                if (isTracking) tracker.start(currentProfile)
                onDispose { tracker.stop() }
            }

            SideEffect { tracker.paused = isSessionPaused }

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
                                endSecs = elapsedSeconds,
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
                drillSeconds = 0
            }

            // Live Timer & BLE Telemetry Broadcast Effect when tracking session is active
            LaunchedEffect(isCountdownActive, activeSessionState, isSessionPaused) {
                if (!isCountdownActive && activeSessionState != null) {
                    // Send initial telemetry immediately
                    bleManager.sendLiveTelemetry(tracker.telemetryJson(elapsedSeconds, isSessionPaused, currentDrillIndex, activeSessionState?.sid))

                    while (true) {
                        delay(1000L)
                        if (!isSessionPaused) {
                            elapsedSeconds += 1
                            drillSeconds += 1
                        }
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

                        // Phone gone: run the same drill durations and rests the phone uses,
                        // so both are on the same drill when they reconnect
                        val alone = !phoneConnected && SystemClock.elapsedRealtime() - phoneLostAt > PHONE_GONE_MS
                        if (alone && sess != null) {
                            if (restRemaining > 0) {
                                restRemaining -= 1
                                if (restRemaining == 0) {
                                    triggerHapticVibration(context)
                                    currentDrillIndex += 1
                                    isSessionPaused = false
                                }
                            } else if (!isSessionPaused) {
                                val minutes = sess.drills.getOrNull(currentDrillIndex)?.durationMinutes ?: 0
                                // (The last drill is handled above for both cases)
                                if (minutes > 0 && drillSeconds >= minutes * 60 && currentDrillIndex < sess.drills.size - 1) {
                                    triggerHapticVibration(context)
                                    restRemaining = REST_BETWEEN_DRILLS_SECONDS
                                    isSessionPaused = true
                                }
                            }
                        }

                        // Broadcast synchronized live telemetry packet to mobile phone
                        bleManager.sendLiveTelemetry(tracker.telemetryJson(elapsedSeconds, isSessionPaused, currentDrillIndex, activeSessionState?.sid))
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
                            runOnUiThread {
                                Log.d(TAG, "Watch received session start signal from mobile: $payload")
                                val session = parseSessionData(payload)
                                try {
                                    CheckedInSession.fromJson(JSONObject(payload.substring(payload.indexOf('{'))))
                                        ?.takeIf { it.venue != null || it.atHome }
                                        ?.let { saveCheckedInSession(it) }
                                } catch (_: Exception) {}
                                // Don't let the previous run's last packet reach the phone
                                bleManager.resetSessionState()
                                activeSessionState = session
                                completedTitle = null
                                completedPacket = null
                                currentDrillIndex = 0
                                workoutCommand = null
                                isCountdownActive = true
                            }
                        }
                        onGattSessionControl = { command ->
                            runOnUiThread {
                                Log.d(TAG, "Watch received session control command: $command")
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
                                when (command) {
                                    "PAUSE" -> isSessionPaused = true
                                    "RESUME" -> isSessionPaused = false
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
                } else if (activeSessionState != null) {
                    ActiveSessionTrackingScreen(
                        sessionData = activeSessionState!!,
                        currentDrillIndex = currentDrillIndex,
                        elapsedSeconds = { elapsedSeconds },
                        drillSeconds = { drillSeconds },
                        tracker = tracker,
                        zone = currentZone,
                        zoneMetrics = zoneMetrics,
                        isPaused = isSessionPaused,
                        phoneConnected = phoneConnected,
                        restRemaining = restRemaining,
                        onTogglePause = {
                            isSessionPaused = !isSessionPaused
                        },
                        onNextDrill = {
                            val totalDrills = maxOf(activeSessionState?.drills?.size ?: 0, activeSessionState?.drillCount ?: 0, 1)
                            if (currentDrillIndex < totalDrills - 1) {
                                currentDrillIndex += 1
                            } else {
                                finishSession(tellPhone = true)
                            }
                        },
                        onEndSession = { finishSession(tellPhone = true) }
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

                // Global Ping Received Alert Banner Overlay
                if (lastPingMessage != null) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 22.dp)
                            .fillMaxWidth(0.90f)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color(0xFF005A36))
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

                // Recording / Movement Status Badge
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.92f)
                            .height(28.dp)
                            .clip(CircleShape)
                            .background(
                                if (isPaused) Color(0xFF332A00)
                                else if (!tracker.onBody) darkRedBg
                                else if (tracker.isMoving) darkMutedGreen
                                else Color(0xFF1E242B)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (isPaused) "⏸ PAUSED"
                                   else if (!tracker.onBody) "⚠ WEAR WATCH ON WRIST"
                                   else if (tracker.isMoving) "● ACTIVE MOVEMENT"
                                   else "○ STATIONARY (TABLE)",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = if (isPaused) amberWarning
                                    else if (!tracker.onBody) brightRedText
                                    else if (tracker.isMoving) emeraldGreen
                                    else Color(0xFF94A3B8)
                        )
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
                            if (show("jumps") && tracker.profile.detectJumps) MetricCell("📱", "JUMPS", Color(0xFFC084FC))
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
                            color = if (isPaused) amberWarning else Color.White
                        )
                        Text(
                            text = when {
                                restRemaining > 0 -> "Rest ${restRemaining / 60}:${String.format(java.util.Locale.US, "%02d", restRemaining % 60)}"
                                !phoneConnected -> "Phone out of range · saving on watch"
                                isPaused -> "Session Paused"
                                else -> "Synced with Phone"
                            },
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = if (isPaused) amberWarning else emeraldGreen
                        )
                    }
                }

                // Pause / Resume Button
                item {
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

                // Next Drill / Complete Drill Button
                item {
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
                                text = "SmartAthlete",
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
