package com.example.smartathlete.presentation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
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
import androidx.compose.runtime.getValue
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

class MainActivity : ComponentActivity() {

    companion object {
        private const val PREFS_NAME = "smartathlete_watch_prefs"
        private const val KEY_IS_LINKED = "is_device_linked"
        private const val KEY_LINKED_DEVICE_NAME = "linked_device_name"
        private const val KEY_PAIRING_CODE = "watch_pairing_code"

        /**
         * Returns existing unique pairing code or generates a unique 6-digit code for this Wear OS device.
         */
        fun getOrCreatePairingCode(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            var code = prefs.getString(KEY_PAIRING_CODE, null)
            if (code.isNullOrBlank() || code.length != 6) {
                code = String.format(java.util.Locale.US, "%06d", (100000..999999).random())
                prefs.edit().putString(KEY_PAIRING_CODE, code).apply()
            }
            return code
        }

        /**
         * Generates a fresh new 6-digit pairing code for this Wear OS device upon unlinking.
         */
        fun generateNewPairingCode(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val newCode = String.format(java.util.Locale.US, "%06d", (100000..999999).random())
            prefs.edit().putString(KEY_PAIRING_CODE, newCode).apply()
            return newCode
        }
    }

    private lateinit var bleManager: BleGattServerManager

    private var hasPermissions by mutableStateOf(false)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        hasPermissions = permissions.values.all { it }
    }

    private var onGattPairingConfirmed: ((String?) -> Unit)? = null
    private var onGattUnlinkRequested: ((String?) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setTheme(android.R.style.Theme_DeviceDefault)

        bleManager = BleGattServerManager(this)

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

            var pendingDeviceName by remember { mutableStateOf<String?>(null) }
            var pendingUnlinkDeviceName by remember { mutableStateOf<String?>(null) }

            // Helper function to parse raw incoming BLE device names
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
            DisposableEffect(isLinked, hasPermissions, pairingCode) {
                if (hasPermissions) {
                    if (!isLinked) {
                        onGattPairingConfirmed = { rawDeviceName ->
                            runOnUiThread {
                                pendingDeviceName = parseDeviceName(rawDeviceName)
                            }
                        }
                        onGattUnlinkRequested = null
                        isAdvertising = bleManager.startServer(
                            pairingCode = pairingCode,
                            onConfirmed = onGattPairingConfirmed,
                            onUnlinkRequested = null
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
                        isAdvertising = bleManager.startServer(
                            pairingCode = pairingCode,
                            onConfirmed = null,
                            onUnlinkRequested = onGattUnlinkRequested
                        )
                    }
                }

                onDispose {
                    bleManager.stopServer()
                }
            }

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
                    },
                    onManualLinkRequest = {
                        pendingDeviceName = "Mobile Phone"
                    }
                )
            } else {
                Home(
                    linkedDeviceName = linkedDeviceName,
                    pendingUnlinkDeviceName = pendingUnlinkDeviceName,
                    pairingCode = pairingCode,
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
        }
    }

    private fun checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val permissions = arrayOf(
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            )
            val needed = permissions.filter {
                ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }
            if (needed.isNotEmpty()) {
                permissionLauncher.launch(needed.toTypedArray())
            } else {
                hasPermissions = true
            }
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
fun Home(
    linkedDeviceName: String = "Mobile Phone",
    pendingUnlinkDeviceName: String? = null,
    pairingCode: String = "849215",
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
                                text = "● Confirm Unlinking",
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
                                    text = "● ",
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
                            onClick = { },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = emeraldGreen,
                                contentColor = Color.White
                            ),
                            modifier = Modifier
                                .fillMaxWidth(0.9f)
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
