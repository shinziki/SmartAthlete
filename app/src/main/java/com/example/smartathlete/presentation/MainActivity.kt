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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import kotlinx.coroutines.delay
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

data class DrillItem(
    val name: String,
    val durationMinutes: Int,
    val category: String = "Drill"
)

data class ActiveSessionData(
    val title: String = "Training Session",
    val drillCount: Int = 0,
    val totalDurationMinutes: Int = 0,
    val drills: List<DrillItem> = emptyList()
)

data class ZoneUpdate(val index: Int?, val zone: String?, val metrics: Set<String>)

private val ZONE_NAMES = listOf("Warm-up", "Tactics", "Conditioning", "Scrimmage", "Cool-down")
private val METRIC_KEYS = listOf("heartRate", "steps", "distance", "playerLoad", "speed", "jumps", "recovery")

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
                                category = itemObj.optString("category", "Drill")
                            )
                        )
                    }
                }

                val finalCount = if (drillCount > 0) drillCount else drillsList.size.coerceAtLeast(1)
                val finalMinutes = if (totalDurationMinutes > 0) totalDurationMinutes else drillsList.sumOf { it.durationMinutes }.coerceAtLeast(15)

                ActiveSessionData(
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
                        DrillItem("Warm-up & Agility", 10, "Agility"),
                        DrillItem("Movement Drills", 10, "Strength"),
                        DrillItem("Cool Down", 10, "Recovery")
                    )
                )
            }
        }
    }

    private lateinit var bleManager: BleGattServerManager
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

        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
            var pendingUnlinkDeviceName by remember { mutableStateOf<String?>(null) }

            var activeSessionState by remember { mutableStateOf<ActiveSessionData?>(null) }
            var isCountdownActive by remember { mutableStateOf(false) }
            var countdownSeconds by remember { mutableIntStateOf(3) }
            var currentDrillIndex by remember { mutableIntStateOf(0) }
            var currentZone by remember { mutableStateOf<String?>(null) }
            var zoneMetrics by remember { mutableStateOf<Set<String>>(emptySet()) }

            var elapsedSeconds by remember { mutableIntStateOf(0) }
            var isSessionPaused by remember { mutableStateOf(false) }

            // Live physical sensor motion state
            var sessionSteps by remember { mutableIntStateOf(0) }
            var sessionMeters by remember { mutableFloatStateOf(0f) }
            var sessionJumps by remember { mutableIntStateOf(0) }
            var sessionHeartRate by remember { mutableIntStateOf(78) }
            var isMoving by remember { mutableStateOf(false) }

            // Sensor Event Listeners for Physical Movement
            DisposableEffect(activeSessionState, isCountdownActive) {
                if (activeSessionState != null && !isCountdownActive) {
                    val sm = sensorManager
                    var initialStepCount = -1
                    var lastStepTime = 0L
                    var lastMovementTime = 0L
                    var pendingJumpSpike = false
                    var jumpSpikeTime = 0L
                    var lastJumpTime = 0L

                    // Reset session sensor state
                    sessionSteps = 0
                    sessionMeters = 0f
                    sessionJumps = 0
                    sessionHeartRate = 78
                    isMoving = false
                    isSessionPaused = false
                    elapsedSeconds = 0

                    val stepCounterSensor = sm?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
                    val stepDetectorSensor = sm?.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
                    val accelSensor = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
                    val hrSensor = sm?.getDefaultSensor(Sensor.TYPE_HEART_RATE)

                    val accelListener = object : SensorEventListener {
                        override fun onSensorChanged(event: SensorEvent) {
                            if (isSessionPaused) return

                            val x = event.values[0]
                            val y = event.values[1]
                            val z = event.values[2]
                            val magnitude = sqrt(x * x + y * y + z * z)
                            val dynamicAcc = abs(magnitude - 9.80665f)
                            val now = System.currentTimeMillis()

                            // Stationary detection: flat on a table produces dynamicAcc < 0.35 m/s²
                            if (dynamicAcc > 0.65f) {
                                lastMovementTime = now
                                isMoving = true
                            } else if (now - lastMovementTime > 2500L) {
                                isMoving = false
                            }

                            // Jump detection: sudden vertical spike > 17.5 m/s² followed by freefall dip < 4.0 m/s²
                            if (magnitude > 17.5f && (now - lastJumpTime > 1200L)) {
                                pendingJumpSpike = true
                                jumpSpikeTime = now
                            } else if (pendingJumpSpike && magnitude < 4.0f && (now - jumpSpikeTime < 450L)) {
                                sessionJumps += 1
                                pendingJumpSpike = false
                                lastJumpTime = now
                            } else if (pendingJumpSpike && (now - jumpSpikeTime > 500L)) {
                                pendingJumpSpike = false
                            }

                            // Fallback step detection using accelerometer if hardware step counter is unavailable
                            if (stepCounterSensor == null && stepDetectorSensor == null && isMoving) {
                                if (dynamicAcc > 2.3f && (now - lastStepTime > 320L)) {
                                    sessionSteps += 1
                                    sessionMeters = sessionSteps * 0.78f
                                    lastStepTime = now
                                }
                            }
                        }

                        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
                    }

                    val stepListener = object : SensorEventListener {
                        override fun onSensorChanged(event: SensorEvent) {
                            if (isSessionPaused) return

                            if (event.sensor.type == Sensor.TYPE_STEP_COUNTER) {
                                val total = event.values[0].toInt()
                                if (initialStepCount < 0) {
                                    initialStepCount = total
                                }
                                val current = max(0, total - initialStepCount)
                                sessionSteps = current
                                sessionMeters = current * 0.78f
                                if (current > 0) {
                                    isMoving = true
                                    lastMovementTime = System.currentTimeMillis()
                                }
                            } else if (event.sensor.type == Sensor.TYPE_STEP_DETECTOR) {
                                sessionSteps += 1
                                sessionMeters = sessionSteps * 0.78f
                                isMoving = true
                                lastMovementTime = System.currentTimeMillis()
                            }
                        }

                        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
                    }

                    val hrListener = object : SensorEventListener {
                        override fun onSensorChanged(event: SensorEvent) {
                            val bpm = event.values[0].toInt()
                            if (bpm > 35) {
                                sessionHeartRate = bpm
                            }
                        }

                        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
                    }

                    if (sm != null) {
                        accelSensor?.let { sm.registerListener(accelListener, it, SensorManager.SENSOR_DELAY_GAME) }
                        stepCounterSensor?.let { sm.registerListener(stepListener, it, SensorManager.SENSOR_DELAY_UI) }
                        stepDetectorSensor?.let { sm.registerListener(stepListener, it, SensorManager.SENSOR_DELAY_UI) }
                        hrSensor?.let { sm.registerListener(hrListener, it, SensorManager.SENSOR_DELAY_NORMAL) }
                    }

                    onDispose {
                        sm?.unregisterListener(accelListener)
                        sm?.unregisterListener(stepListener)
                        sm?.unregisterListener(hrListener)
                    }
                } else {
                    onDispose {}
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

            // Live Timer & BLE Telemetry Broadcast Effect when tracking session is active
            LaunchedEffect(isCountdownActive, activeSessionState, isSessionPaused) {
                if (!isCountdownActive && activeSessionState != null) {
                    // Send initial telemetry immediately
                    val initialJson = "{\"secs\":$elapsedSeconds,\"steps\":$sessionSteps,\"meters\":${String.format(java.util.Locale.US, "%.1f", sessionMeters)},\"jumps\":$sessionJumps,\"bpm\":$sessionHeartRate,\"moving\":$isMoving,\"paused\":$isSessionPaused,\"drill\":$currentDrillIndex}"
                    bleManager.sendLiveTelemetry(initialJson)

                    while (true) {
                        delay(1000L)
                        if (!isSessionPaused) {
                            elapsedSeconds += 1
                        }

                        // Broadcast synchronized live telemetry packet to mobile phone
                        val telemetryJson = "{\"secs\":$elapsedSeconds,\"steps\":$sessionSteps,\"meters\":${String.format(java.util.Locale.US, "%.1f", sessionMeters)},\"jumps\":$sessionJumps,\"bpm\":$sessionHeartRate,\"moving\":$isMoving,\"paused\":$isSessionPaused,\"drill\":$currentDrillIndex}"
                        bleManager.sendLiveTelemetry(telemetryJson)
                    }
                }
            }

            fun parseDeviceName(rawInput: String?): String {
                if (rawInput.isNullOrBlank()) return "Mobile Phone"

                val parts = rawInput.split("|")
                val payload = parts[0].trim()
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
                            onPingReceived = onGattPingReceived
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
                                activeSessionState = session
                                currentDrillIndex = 0
                                isCountdownActive = true
                            }
                        }
                        onGattSessionControl = { command ->
                            runOnUiThread {
                                Log.d(TAG, "Watch received session control command: $command")
                                when (command) {
                                    "PAUSE" -> isSessionPaused = true
                                    "RESUME" -> isSessionPaused = false
                                    "END" -> {
                                        activeSessionState = null
                                        isCountdownActive = false
                                        currentZone = null
                                        zoneMetrics = emptySet()
                                    }
                                    "NEXT_DRILL" -> {
                                        val total = maxOf(activeSessionState?.drills?.size ?: 0, activeSessionState?.drillCount ?: 0, 1)
                                        currentDrillIndex = (currentDrillIndex + 1) % total
                                    }
                                    "PREV_DRILL" -> {
                                        if (currentDrillIndex > 0) currentDrillIndex -= 1
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
                            onPingReceived = onGattPingReceived
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
                                .apply()
                            linkedDeviceName = deviceToSave
                            isLinked = true
                            pendingDeviceName = null
                        },
                        onDeclineLink = {
                            bleManager.sendPairingResponse(false)
                            pendingDeviceName = null
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
                        elapsedSeconds = elapsedSeconds,
                        steps = sessionSteps,
                        meters = sessionMeters,
                        jumps = sessionJumps,
                        heartRate = sessionHeartRate,
                        zone = currentZone,
                        zoneMetrics = zoneMetrics,
                        isMoving = isMoving,
                        isPaused = isSessionPaused,
                        onTogglePause = {
                            isSessionPaused = !isSessionPaused
                        },
                        onNextDrill = {
                            val totalDrills = maxOf(activeSessionState?.drills?.size ?: 0, activeSessionState?.drillCount ?: 0, 1)
                            if (currentDrillIndex < totalDrills - 1) {
                                currentDrillIndex += 1
                            } else {
                                activeSessionState = null
                                isCountdownActive = false
                            }
                        },
                        onEndSession = {
                            activeSessionState = null
                            isCountdownActive = false
                        }
                    )
                } else {
                    Home(
                        linkedDeviceName = linkedDeviceName,
                        pendingUnlinkDeviceName = pendingUnlinkDeviceName,
                        pairingCode = pairingCode,
                        onStartSessionManual = {
                            activeSessionState = ActiveSessionData(
                                title = "Strength & Conditioning",
                                drillCount = 3,
                                totalDurationMinutes = 45,
                                drills = listOf(
                                    DrillItem("Barbell Back Squat", 15, "Strength"),
                                    DrillItem("Depth Jumps", 15, "Plyometrics"),
                                    DrillItem("Lateral Agility Shuttles", 15, "Agility")
                                )
                            )
                            currentDrillIndex = 0
                            isCountdownActive = true
                        },
                        onConfirmUnlink = {
                            bleManager.sendPairingResponse(true)
                            val freshCode = generateNewPairingCode(context)
                            prefs.edit()
                                .putBoolean(KEY_IS_LINKED, false)
                                .remove(KEY_LINKED_DEVICE_NAME)
                                .apply()
                            pairingCode = freshCode
                            isLinked = false
                            pendingUnlinkDeviceName = null
                        },
                        onCancelUnlink = {
                            bleManager.sendPairingResponse(false)
                            pendingUnlinkDeviceName = null
                        },
                        onRequestUnlink = {
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
    elapsedSeconds: Int,
    steps: Int,
    meters: Float,
    jumps: Int,
    heartRate: Int,
    zone: String?,
    zoneMetrics: Set<String>,
    isMoving: Boolean,
    isPaused: Boolean,
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

    val mins = elapsedSeconds / 60
    val secs = elapsedSeconds % 60
    val formattedTime = String.format(java.util.Locale.US, "%02d:%02d", mins, secs)
    val tracked = zoneMetrics.filter { it in listOf("steps", "distance", "jumps", "heartRate") }
    fun show(k: String) = tracked.isEmpty() || k in tracked

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
                                else if (isMoving) darkMutedGreen
                                else Color(0xFF1E242B)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (isPaused) "⏸ PAUSED"
                                   else if (isMoving) "● ACTIVE MOVEMENT"
                                   else "○ STATIONARY (TABLE)",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = if (isPaused) amberWarning
                                    else if (isMoving) emeraldGreen
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
                            if (show("steps")) MetricCell("$steps", "STEPS", emeraldGreen)
                            if (show("distance")) MetricCell("${meters.toInt()}m", "DISTANCE", Color(0xFF38BDF8))
                            if (show("jumps")) MetricCell("$jumps", "JUMPS", Color(0xFFC084FC))
                            if (tracked.contains("heartRate")) MetricCell(if (heartRate > 0) "$heartRate" else "--", "BPM", Color(0xFFFF6B6B))
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
                                    text = "• ${currentDrill.durationMinutes}m",
                                    style = MaterialTheme.typography.bodyExtraSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
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
                            text = formattedTime,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.ExtraBold,
                            color = if (isPaused) amberWarning else Color.White
                        )
                        Text(
                            text = if (isPaused) "Session Paused" else "Synced with Phone",
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
fun Home(
    linkedDeviceName: String = "Mobile Phone",
    pendingUnlinkDeviceName: String? = null,
    pairingCode: String = "849215",
    onStartSessionManual: () -> Unit = {},
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
                            text = "Unlink $displayUnlinkDevice from Watch #$pairingCode and return to pairing mode?",
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

                            Button(
                                onClick = onConfirmUnlink,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFFB71C1C),
                                    contentColor = Color.White
                                ),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = "Unlink",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
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
                            text = "Strength & Conditioning",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    item {
                        Text(
                            text = "EVSU Ormoc Gymnasium",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
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
                        Button(
                            onClick = onStartSessionManual,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = emeraldGreen,
                                contentColor = Color.White
                            ),
                            modifier = Modifier.fillMaxWidth(0.9f)
                        ) {
                            Text(
                                text = "▶ Start session",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    item {
                        Text(
                            text = "Records during team training only",
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
