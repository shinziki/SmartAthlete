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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
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
        private const val DEFAULT_PAIRING_CODE = "849215"
    }

    private lateinit var bleManager: BleGattServerManager

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (allGranted) {
            startBleAdvertising()
        }
    }

    private var onGattPairingConfirmed: ((String?) -> Unit)? = null

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

            var isAdvertising by remember { mutableStateOf(false) }

            var pendingDeviceName by remember { mutableStateOf<String?>(null) }

            // Connect BLE callback to Compose state
            DisposableEffect(isLinked) {
                if (!isLinked) {
                    onGattPairingConfirmed = { rawDeviceName ->
                        runOnUiThread {
                            val displayName = if (rawDeviceName.isNullOrBlank() || rawDeviceName == "CONFIRM") {
                                "Mobile Device"
                            } else {
                                rawDeviceName
                            }
                            pendingDeviceName = displayName
                        }
                    }
                    isAdvertising = bleManager.startServer(DEFAULT_PAIRING_CODE, onGattPairingConfirmed!!)
                } else {
                    bleManager.stopServer()
                    isAdvertising = false
                }

                onDispose {
                    bleManager.stopServer()
                }
            }

            if (!isLinked) {
                DeviceLinkPromptScreen(
                    pairingCode = DEFAULT_PAIRING_CODE,
                    isAdvertising = isAdvertising,
                    pendingDeviceName = pendingDeviceName,
                    onAcceptLink = {
                        prefs.edit().putBoolean(KEY_IS_LINKED, true).apply()
                        isLinked = true
                        pendingDeviceName = null
                        bleManager.stopServer()
                        isAdvertising = false
                    },
                    onDeclineLink = {
                        pendingDeviceName = null
                    },
                    onManualLinkRequest = {
                        pendingDeviceName = "Mobile Device"
                    }
                )
            } else {
                Home(
                    onUnlink = {
                        prefs.edit().putBoolean(KEY_IS_LINKED, false).apply()
                        isLinked = false
                        pendingDeviceName = null
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
                startBleAdvertising()
            }
        } else {
            startBleAdvertising()
        }
    }

    private fun startBleAdvertising() {
        onGattPairingConfirmed?.let { callback ->
            bleManager.startServer(DEFAULT_PAIRING_CODE, callback)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        bleManager.stopServer()
    }
}

@Composable
fun Home(
    onUnlink: () -> Unit = {}
) {
    val emeraldGreen = Color(0xFF00A86B)
    val darkMutedGreen = Color(0xFF0B2B22)

    val listState = rememberTransformingLazyColumnState()

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
                        text = "Device Linked (Watch #849215)",
                        style = MaterialTheme.typography.bodyExtraSmall,
                        color = emeraldGreen,
                        textAlign = TextAlign.Center
                    )
                }

                item {
                    CompactButton(
                        onClick = onUnlink,
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
