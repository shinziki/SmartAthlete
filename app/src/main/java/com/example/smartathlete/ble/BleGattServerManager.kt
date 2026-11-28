package com.example.smartathlete.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * BleGattServerManager
 *
 * Runs a BLE GATT peripheral server on the Wear OS watch.
 * Advertises the SmartAthlete pairing service and allows the mobile phone
 * to connect, read pairing info, request pairing or unlinking,
 * receive start session tracking commands, stream live sensor telemetry,
 * and send accept/decline responses via BLE notifications.
 */
class BleGattServerManager(private val context: Context) {

    companion object {
        private const val TAG = "BleGattServer"

        val BLE_SERVICE_UUID: UUID = UUID.fromString("0000FFAA-0000-1000-8000-00805F9B34FB")
        val DEVICE_NAME_CHAR_UUID: UUID = UUID.fromString("0000FFB1-0000-1000-8000-00805F9B34FB")
        val PAIRING_CODE_CHAR_UUID: UUID = UUID.fromString("0000FFB2-0000-1000-8000-00805F9B34FB")
        val PAIRING_CONFIRM_CHAR_UUID: UUID = UUID.fromString("0000FFB3-0000-1000-8000-00805F9B34FB")
        val PAIRING_RESPONSE_CHAR_UUID: UUID = UUID.fromString("0000FFB4-0000-1000-8000-00805F9B34FB")
        val LIVE_TELEMETRY_CHAR_UUID: UUID = UUID.fromString("0000FFB5-0000-1000-8000-00805F9B34FB")
        // Permanent ID of this watch (unlike the BLE address, it never rotates)
        val WATCH_ID_CHAR_UUID: UUID = UUID.fromString("0000FFB6-0000-1000-8000-00805F9B34FB")

        /** Tries for an answer notification when the link is busy, and the pause between them */
        private const val NOTIFY_ATTEMPTS = 6
        private const val NOTIFY_RETRY_MS = 40L

        // Standard Client Characteristic Configuration Descriptor UUID
        val CCC_DESCRIPTOR_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")
    }

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null

    private var currentPairingCode: String = ""
    private var onPairingConfirmedListener: ((String?) -> Unit)? = null
    private var onUnlinkRequestedListener: ((String?) -> Unit)? = null
    private var onSessionStartListener: ((String) -> Unit)? = null
    private var onSessionControlListener: ((String) -> Unit)? = null
    private var onPingReceivedListener: (() -> Unit)? = null
    private var onPairingWhileLinkedListener: ((String) -> Unit)? = null
    private var onDrillAckListener: ((String, Int) -> Unit)? = null
    /** Told whenever the phone connects or drops (e.g. walks out of range) */
    var onPhoneConnectionChanged: ((Boolean) -> Unit)? = null
    /** Phone's answer to an unlink started on the watch: CONFIRMED / DECLINED / NOTICE_ACK */
    var onWatchUnlinkReply: ((String) -> Unit)? = null

    fun isPhoneConnected(): Boolean = connectedDevice != null
    private var watchUid: String = ""

    // Track connected device for sending notifications back
    private var connectedDevice: BluetoothDevice? = null
    // Track the response characteristic for pairing notifications
    private var responseCharacteristic: BluetoothGattCharacteristic? = null
    // Track the telemetry characteristic for live movement streaming
    private var telemetryCharacteristic: BluetoothGattCharacteristic? = null

    @Volatile
    private var latestTelemetryJson: String = "{}"

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            Log.d(TAG, "BLE advertising started successfully")
        }

        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "BLE advertising failed with error code: $errorCode")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {

        override fun onServiceAdded(status: Int, service: BluetoothGattService) {
            super.onServiceAdded(status, service)
            Log.d(TAG, "GATT service registered: ${service.uuid} with status $status")
        }

        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            super.onConnectionStateChange(device, status, newState)
            if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                connectedDevice = device
                Log.d(TAG, "Device connected: ${device.address}")
                onPhoneConnectionChanged?.invoke(true)
            } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
                if (connectedDevice?.address == device.address) {
                    connectedDevice = null
                    onPhoneConnectionChanged?.invoke(false)
                }
                Log.d(TAG, "Device disconnected: ${device.address}")
            }
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            super.onCharacteristicReadRequest(device, requestId, offset, characteristic)

            when (characteristic.uuid) {
                PAIRING_CODE_CHAR_UUID -> {
                    val value = currentPairingCode.toByteArray(StandardCharsets.UTF_8)
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                DEVICE_NAME_CHAR_UUID -> {
                    val name = "SmartAthlete Watch"
                    val value = name.toByteArray(StandardCharsets.UTF_8)
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                PAIRING_RESPONSE_CHAR_UUID -> {
                    @Suppress("DEPRECATION")
                    val value = responseCharacteristic?.value ?: ByteArray(0)
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                WATCH_ID_CHAR_UUID -> {
                    val value = watchUid.toByteArray(StandardCharsets.UTF_8)
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                LIVE_TELEMETRY_CHAR_UUID -> {
                    connectedDevice = device
                    val value = latestTelemetryJson.toByteArray(StandardCharsets.UTF_8)
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                else -> {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            super.onCharacteristicWriteRequest(
                device, requestId, characteristic, preparedWrite, responseNeeded, offset, value
            )

            if (characteristic.uuid == PAIRING_CONFIRM_CHAR_UUID) {
                val confirmStr = value?.let { String(it, StandardCharsets.UTF_8) } ?: ""
                Log.d(TAG, "Received write command on confirm characteristic from ${device.address}: '$confirmStr'")

                // (The last response is cleared only by a new pairing request below. Clearing it
                // on every write wiped a PONG before the phone could read it whenever another
                // command arrived meanwhile: pings failed most of the time, pilot 2026-11-27.)

                // Track connected device
                connectedDevice = device

                if (responseNeeded) {
                    if (preparedWrite) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                    } else {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                    }
                }

                @SuppressLint("MissingPermission")
                val btDeviceName = try { device.name } catch (_: Exception) { null }

                val payloadWithBtName = if (!btDeviceName.isNullOrBlank()) {
                    "$confirmStr|$btDeviceName"
                } else {
                    confirmStr
                }

                val trimmedStr = confirmStr.trim()
                val upperStr = trimmedStr.uppercase()

                when {
                    // Session control commands during active tracking
                    upperStr.startsWith("PING") || upperStr == "PING" -> {
                        Log.d(TAG, "PING command received from ${device.address}")
                        // Echo the phone's token ("PING:<token>" -> "PONG:<token>") so the phone
                        // can tell this answer from a PONG left over from an earlier ping
                        val token = trimmedStr.substringAfter(":", "").trim()
                        sendPairingResponseStr(if (token.isNotEmpty()) "PONG:$token" else "PONG")
                        onPingReceivedListener?.invoke()
                    }

                    // Checked first: the workout name inside the JSON could contain other command words
                    // Phone confirms it received a drill record stored on the watch
                    // Answers to an unlink started on the watch (checked before the generic UNLINK)
                    upperStr.startsWith("UNLINK_CONFIRMED") -> onWatchUnlinkReply?.invoke("CONFIRMED")
                    upperStr.startsWith("UNLINK_DECLINED") -> onWatchUnlinkReply?.invoke("DECLINED")
                    upperStr.startsWith("UNLINK_NOTICE_ACK") -> onWatchUnlinkReply?.invoke("NOTICE_ACK")

                    upperStr.startsWith("DRILL_ACK:") -> {
                        val parts = trimmedStr.substringAfter(":").split(":")
                        val index = parts.lastOrNull()?.toIntOrNull()
                        val sid = parts.dropLast(1).joinToString(":")
                        if (index != null && sid.isNotBlank()) onDrillAckListener?.invoke(sid, index)
                    }

                    // Wearer verification (checked before CONFIRM / the session words: the name
                    // inside WEARER could contain them)
                    upperStr.startsWith("WEARER=") -> onSessionControlListener?.invoke(trimmedStr)
                    upperStr.startsWith("VERIFY_OK") -> onSessionControlListener?.invoke("VERIFY_OK")
                    upperStr.startsWith("VERIFY_REQ") -> onSessionControlListener?.invoke("VERIFY_REQ")
                    upperStr.startsWith("VERIFY_END") -> onSessionControlListener?.invoke("VERIFY_END")
                    upperStr.startsWith("VERIFY_COACH") -> onSessionControlListener?.invoke("VERIFY_COACH")

                    // The phone hands the session to the watch: the athlete starts it from the
                    // wrist (checked before the session-start words, which the JSON could hold)
                    upperStr.startsWith("ARM_SESSION:") -> onSessionControlListener?.invoke(trimmedStr)
                    upperStr.startsWith("DISARM") -> onSessionControlListener?.invoke("DISARM")

                    // Pairing request. A linked watch answers it itself (same account or IN_USE)
                    // instead of letting it fall through to the session-start handling below.
                    upperStr.startsWith("CONFIRM") -> {
                        // A new pairing request: forget the answer to an earlier one
                        @Suppress("DEPRECATION")
                        responseCharacteristic?.value = ByteArray(0)
                        if (onPairingConfirmedListener != null) {
                            Log.d(TAG, "Pairing request while unlinked -> prompting watch user")
                            onPairingConfirmedListener?.invoke(payloadWithBtName)
                        } else {
                            Log.d(TAG, "Pairing request while linked -> checking account")
                            onPairingWhileLinkedListener?.invoke(payloadWithBtName)
                        }
                    }

                    // Details of the session the athlete checked in to (venue / at home)
                    upperStr.startsWith("SESSION_INFO:") -> {
                        Log.d(TAG, "Session info received")
                        onSessionControlListener?.invoke(trimmedStr)
                    }

                    upperStr.startsWith("WORKOUT:") -> {
                        Log.d(TAG, "Active workout received: '$trimmedStr'")
                        onSessionControlListener?.invoke(trimmedStr)
                    }

                    upperStr.startsWith("GEOFENCE_WARN") -> {
                        Log.d(TAG, "Geofence boundary warning received")
                        onSessionControlListener?.invoke("GEOFENCE_WARN")
                    }

                    upperStr.contains("PAUSE_SESSION") || upperStr == "PAUSE" -> {
                        // "PAUSE_SESSION:REST:<secs>" = the rest between drills, not a plain pause
                        val restSecs = Regex("REST:(\\d+)").find(upperStr)?.groupValues?.get(1)?.toIntOrNull()
                        Log.d(TAG, "Session PAUSE command received (rest=$restSecs)")
                        onSessionControlListener?.invoke(if (restSecs != null) "REST:$restSecs" else "PAUSE")
                    }

                    upperStr.contains("RESUME_SESSION") || upperStr == "RESUME" -> {
                        Log.d(TAG, "Session RESUME command received")
                        onSessionControlListener?.invoke("RESUME")
                    }

                    upperStr.contains("END_SESSION") || upperStr == "END" || upperStr.contains("STOP_SESSION") -> {
                        Log.d(TAG, "Session END command received")
                        onSessionControlListener?.invoke("END")
                    }

                    upperStr.startsWith("ZONE:") || upperStr.startsWith("ZONE_SYNC:") || upperStr.startsWith("SET_ZONE:") -> {
                        Log.d(TAG, "Zone sync command received: '$trimmedStr'")
                        onSessionControlListener?.invoke(trimmedStr)
                    }

                    upperStr.startsWith("REGIME:") || upperStr.startsWith("REGIME") -> {
                        Log.d(TAG, "Drill regime update received: '$trimmedStr'")
                        onSessionControlListener?.invoke(trimmedStr)
                    }

                    upperStr.startsWith("SET_DRILL:") -> {
                        Log.d(TAG, "Set drill command received: '$trimmedStr'")
                        onSessionControlListener?.invoke(trimmedStr)
                    }

                    upperStr.contains("PREV_DRILL") -> {
                        Log.d(TAG, "Session PREV_DRILL command received")
                        onSessionControlListener?.invoke("PREV_DRILL")
                    }

                    upperStr.contains("NEXT_DRILL") -> {
                        Log.d(TAG, "Session NEXT_DRILL command received")
                        onSessionControlListener?.invoke("NEXT_DRILL")
                    }

                    // (Also START_SESSION with a "rejoin" block: back into the phone's running session)
                    upperStr.contains("START_SESSION") ||
                    upperStr.contains("SESSION_START") ||
                    upperStr.contains("START_TRACKING") ||
                    (trimmedStr.startsWith("{") && trimmedStr.endsWith("}")) -> {
                        Log.d(TAG, "Start Session payload detected -> triggering onSessionStartListener")
                        onSessionStartListener?.invoke(trimmedStr)
                    }

                    upperStr.contains("UNLINK") -> {
                        Log.d(TAG, "Explicit Unlink payload detected -> triggering onUnlinkRequestedListener")
                        onUnlinkRequestedListener?.invoke(payloadWithBtName)
                    }

                    onPairingConfirmedListener != null -> {
                        Log.d(TAG, "Pairing confirmation command detected -> triggering onPairingConfirmedListener")
                        onPairingConfirmedListener?.invoke(payloadWithBtName)
                    }

                    onUnlinkRequestedListener != null -> {
                        Log.d(TAG, "Unmapped command in linked state: '$trimmedStr'")
                        if (trimmedStr.contains("{") || trimmedStr.contains(":")) {
                            Log.d(TAG, "Attempting session start for structured payload in linked state")
                            onSessionStartListener?.invoke(trimmedStr)
                        } else {
                            Log.w(TAG, "Ignoring unknown GATT write payload in linked state: '$trimmedStr'")
                        }
                    }
                }
            } else {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            super.onDescriptorWriteRequest(device, requestId, descriptor, preparedWrite, responseNeeded, offset, value)

            if (descriptor.uuid == CCC_DESCRIPTOR_UUID) {
                Log.d(TAG, "CCC descriptor written by ${device.address} - notifications enabled")
                connectedDevice = device
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
            } else {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            descriptor: BluetoothGattDescriptor
        ) {
            super.onDescriptorReadRequest(device, requestId, offset, descriptor)
            if (descriptor.uuid == CCC_DESCRIPTOR_UUID) {
                gattServer?.sendResponse(
                    device, requestId, BluetoothGatt.GATT_SUCCESS, offset,
                    BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                )
            } else {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
            }
        }
    }

    /**
     * Clears characteristic response buffer.
     */
    fun clearPairingResponse() {
        @Suppress("DEPRECATION")
        responseCharacteristic?.value = ByteArray(0)
        Log.d(TAG, "Cleared pairing response characteristic")
    }

    /**
     * Sends ACCEPTED or DECLINED as a BLE notification to the connected mobile phone.
     */
    /**
     * Resets telemetry characteristic state back to clean initial values
     * so stale session completion packets are never retained when starting a new session.
     */
    @SuppressLint("MissingPermission")
    fun resetSessionState() {
        latestTelemetryJson = "{\"secs\":0,\"steps\":0,\"meters\":0.0,\"jumps\":0,\"bpm\":0,\"moving\":false,\"paused\":false,\"drill\":0,\"completed\":false}"
        try {
            @Suppress("DEPRECATION")
            telemetryCharacteristic?.value = latestTelemetryJson.toByteArray(StandardCharsets.UTF_8)
            @Suppress("DEPRECATION")
            responseCharacteristic?.value = "READY".toByteArray(StandardCharsets.UTF_8)
            Log.d(TAG, "Telemetry and pairing characteristics successfully reset for new session")
        } catch (e: Exception) {
            Log.w(TAG, "Error resetting session characteristics: ${e.message}")
        }
    }

    fun sendPairingResponseStr(responseStr: String) {
        val responseBytes = responseStr.toByteArray(StandardCharsets.UTF_8)
        val characteristic = responseCharacteristic
        val server = gattServer

        if (characteristic == null || server == null) {
            Log.e(TAG, "Cannot send response '$responseStr': characteristic=$characteristic, server=$server")
            return
        }

        try {
            @Suppress("DEPRECATION")
            characteristic.value = responseBytes

            val devicesToNotify = mutableSetOf<BluetoothDevice>()
            connectedDevice?.let { devicesToNotify.add(it) }
            try {
                bluetoothManager?.getConnectedDevices(android.bluetooth.BluetoothProfile.GATT)?.forEach {
                    devicesToNotify.add(it)
                }
            } catch (_: Exception) {}

            // Answers (PONG, ACCEPTED…) must get through: the link sends one notification at
            // a time and telemetry goes out every second, so a busy link is tried again.
            // The phone also reads the value if a notification is still lost.
            for (dev in devicesToNotify) {
                var sent = false
                for (attempt in 0 until NOTIFY_ATTEMPTS) {
                    sent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        server.notifyCharacteristicChanged(dev, characteristic, false, responseBytes) ==
                            android.bluetooth.BluetoothStatusCodes.SUCCESS
                    } else {
                        @Suppress("DEPRECATION")
                        server.notifyCharacteristicChanged(dev, characteristic, false)
                    }
                    if (sent) break
                    try { Thread.sleep(NOTIFY_RETRY_MS) } catch (_: InterruptedException) { break }
                }
                if (!sent) Log.w(TAG, "Response '$responseStr' not notified to ${dev.address} (link busy); the phone can still read it")
            }
            Log.d(TAG, "Response '$responseStr' sent to ${devicesToNotify.size} device(s)")
        } catch (e: Exception) {
            Log.e(TAG, "Error sending pairing response notification '$responseStr'", e)
        }
    }

    @SuppressLint("MissingPermission")
    fun sendPairingResponse(accepted: Boolean) {
        sendPairingResponseStr(if (accepted) "ACCEPTED" else "DECLINED")
    }

    /**
     * Streams real-time live movement telemetry (elapsed time, steps, meters, jumps, heart rate)
     * as a BLE notification to the connected phone.
     */
    @SuppressLint("MissingPermission")
    fun sendLiveTelemetry(telemetryJson: String) {
        latestTelemetryJson = telemetryJson
        val characteristic = telemetryCharacteristic
        val server = gattServer

        if (characteristic == null || server == null) {
            return
        }

        val telemetryBytes = telemetryJson.toByteArray(StandardCharsets.UTF_8)
        try {
            @Suppress("DEPRECATION")
            characteristic.value = telemetryBytes

            val devicesToNotify = mutableSetOf<BluetoothDevice>()
            connectedDevice?.let { devicesToNotify.add(it) }
            try {
                bluetoothManager?.getConnectedDevices(android.bluetooth.BluetoothProfile.GATT)?.forEach {
                    devicesToNotify.add(it)
                }
            } catch (_: Exception) {}

            for (dev in devicesToNotify) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    server.notifyCharacteristicChanged(dev, characteristic, false, telemetryBytes)
                } else {
                    @Suppress("DEPRECATION")
                    server.notifyCharacteristicChanged(dev, characteristic, false)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error notifying live telemetry: ${e.message}")
        }
    }

    /**
     * Sends a stored drill record to the phone as a telemetry notification. Unlike
     * [sendLiveTelemetry] it doesn't replace the value the phone reads when polling.
     */
    @SuppressLint("MissingPermission")
    fun sendDrillRecord(recordJson: String) {
        val characteristic = telemetryCharacteristic ?: return
        val server = gattServer ?: return
        val device = connectedDevice ?: return
        val bytes = recordJson.toByteArray(StandardCharsets.UTF_8)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                server.notifyCharacteristicChanged(device, characteristic, false, bytes)
            } else {
                @Suppress("DEPRECATION")
                characteristic.value = bytes
                @Suppress("DEPRECATION")
                server.notifyCharacteristicChanged(device, characteristic, false)
                // Restore what polling reads
                @Suppress("DEPRECATION")
                characteristic.value = latestTelemetryJson.toByteArray(StandardCharsets.UTF_8)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error sending drill record: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    fun startServer(
        pairingCode: String,
        onConfirmed: ((String?) -> Unit)? = null,
        onUnlinkRequested: ((String?) -> Unit)? = null,
        onSessionStart: ((String) -> Unit)? = null,
        onSessionControl: ((String) -> Unit)? = null,
        onPingReceived: (() -> Unit)? = null,
        onPairingWhileLinked: ((String) -> Unit)? = null,
        onDrillAck: ((String, Int) -> Unit)? = null,
        watchId: String = ""
    ): Boolean {
        // Ensure any previous server instance is cleanly closed
        stopServer()

        currentPairingCode = pairingCode
        onPairingConfirmedListener = onConfirmed
        onUnlinkRequestedListener = onUnlinkRequested
        onSessionStartListener = onSessionStart
        onSessionControlListener = onSessionControl
        onPingReceivedListener = onPingReceived
        onPairingWhileLinkedListener = onPairingWhileLinked
        onDrillAckListener = onDrillAck
        watchUid = watchId

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            Log.e(TAG, "Bluetooth is disabled or not available")
            return false
        }

        try {
            // 1. Open GATT Server
            gattServer = bluetoothManager?.openGattServer(context, gattServerCallback)
            if (gattServer == null) {
                Log.e(TAG, "Unable to open GATT server")
                return false
            }

            // 2. Setup Primary Service & Characteristics
            val service = BluetoothGattService(BLE_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

            // Device Name Characteristic (Read)
            val nameChar = BluetoothGattCharacteristic(
                DEVICE_NAME_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            )

            // Pairing Code Characteristic (Read)
            val codeChar = BluetoothGattCharacteristic(
                PAIRING_CODE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            )

            // Pairing Confirm Characteristic (Write) - phone writes CONFIRMED, UNLINK, START_SESSION, WORKOUT, PAUSE, RESUME, END
            val confirmChar = BluetoothGattCharacteristic(
                PAIRING_CONFIRM_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )

            // Pairing Response Characteristic (Read + Notify) - watch sends ACCEPTED/DECLINED
            val respChar = BluetoothGattCharacteristic(
                PAIRING_RESPONSE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            )

            // Add CCC Descriptor so the phone can subscribe to pairing notifications
            val cccDescriptor = BluetoothGattDescriptor(
                CCC_DESCRIPTOR_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            @Suppress("DEPRECATION")
            cccDescriptor.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            respChar.addDescriptor(cccDescriptor)

            // Live Telemetry Characteristic (Read + Notify) - watch streams live motion sensors & elapsed time
            val telemetryChar = BluetoothGattCharacteristic(
                LIVE_TELEMETRY_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            )

            // Add CCC Descriptor so the phone can subscribe to live telemetry notifications
            val telemetryCcc = BluetoothGattDescriptor(
                CCC_DESCRIPTOR_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            @Suppress("DEPRECATION")
            telemetryCcc.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            telemetryChar.addDescriptor(telemetryCcc)

            // Store references for sending notifications later
            responseCharacteristic = respChar
            telemetryCharacteristic = telemetryChar

            service.addCharacteristic(nameChar)
            service.addCharacteristic(codeChar)
            service.addCharacteristic(confirmChar)
            service.addCharacteristic(respChar)
            service.addCharacteristic(telemetryChar)
            service.addCharacteristic(
                BluetoothGattCharacteristic(
                    WATCH_ID_CHAR_UUID,
                    BluetoothGattCharacteristic.PROPERTY_READ,
                    BluetoothGattCharacteristic.PERMISSION_READ
                )
            )

            gattServer?.addService(service)

            // 3. Start BLE Advertising
            advertiser = bluetoothAdapter.bluetoothLeAdvertiser
            if (advertiser == null) {
                Log.e(TAG, "BLE Advertiser is not supported on this device")
                return false
            }

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build()

            // Primary advertise packet: limited strictly to 31 bytes (Flags=3, 128-bit UUID=18 -> 21 <= 31 bytes)
            val advertiseData = AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .setIncludeTxPowerLevel(false)
                .addServiceUuid(ParcelUuid(BLE_SERVICE_UUID))
                .build()

            // Scan response packet: holds the 20-byte device name without overflowing primary advertising data
            val scanResponseData = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .build()

            advertiser?.startAdvertising(settings, advertiseData, scanResponseData, advertiseCallback)
            Log.d(TAG, "GATT Server and Advertising started with code: $pairingCode")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error starting GATT server", e)
            return false
        }
    }

    @SuppressLint("MissingPermission")
    fun stopServer() {
        try {
            advertiser?.stopAdvertising(advertiseCallback)
            advertiser = null
            gattServer?.close()
            gattServer = null
            connectedDevice = null
            responseCharacteristic = null
            telemetryCharacteristic = null
            latestTelemetryJson = "{}"
            Log.d(TAG, "GATT server and advertising stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping GATT server", e)
        }
    }
}
