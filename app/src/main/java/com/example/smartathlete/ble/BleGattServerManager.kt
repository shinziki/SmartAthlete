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
 * receive start session tracking commands,
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

    // Track connected device for sending notifications back
    private var connectedDevice: BluetoothDevice? = null
    // Track the response characteristic for notifications
    private var responseCharacteristic: BluetoothGattCharacteristic? = null

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            Log.d(TAG, "BLE advertising started successfully")
        }

        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "BLE advertising failed with error code: $errorCode")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {

        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            super.onConnectionStateChange(device, status, newState)
            if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                connectedDevice = device
                Log.d(TAG, "Device connected: ${device.address}")
            } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
                if (connectedDevice?.address == device.address) {
                    connectedDevice = null
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

                // Clear any previous stale response
                @Suppress("DEPRECATION")
                responseCharacteristic?.value = ByteArray(0)

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
    @SuppressLint("MissingPermission")
    fun sendPairingResponse(accepted: Boolean) {
        val responseStr = if (accepted) "ACCEPTED" else "DECLINED"
        val responseBytes = responseStr.toByteArray(StandardCharsets.UTF_8)

        val characteristic = responseCharacteristic
        val device = connectedDevice
        val server = gattServer

        if (characteristic == null || server == null) {
            Log.e(TAG, "Cannot send pairing response: characteristic=$characteristic, server=$server")
            return
        }

        try {
            @Suppress("DEPRECATION")
            characteristic.value = responseBytes

            if (device != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val sent = server.notifyCharacteristicChanged(device, characteristic, false, responseBytes)
                    Log.d(TAG, "Pairing response '$responseStr' (API 33+) sent to ${device.address}: $sent")
                } else {
                    @Suppress("DEPRECATION")
                    val sent = server.notifyCharacteristicChanged(device, characteristic, false)
                    Log.d(TAG, "Pairing response '$responseStr' (legacy) sent to ${device.address}: $sent")
                }
            } else {
                Log.w(TAG, "connectedDevice is null when sending pairing response notification")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error sending pairing response notification", e)
        }
    }

    @SuppressLint("MissingPermission")
    fun startServer(
        pairingCode: String,
        onConfirmed: ((String?) -> Unit)? = null,
        onUnlinkRequested: ((String?) -> Unit)? = null,
        onSessionStart: ((String) -> Unit)? = null
    ): Boolean {
        // Ensure any previous server instance is cleanly closed
        stopServer()

        currentPairingCode = pairingCode
        onPairingConfirmedListener = onConfirmed
        onUnlinkRequestedListener = onUnlinkRequested
        onSessionStartListener = onSessionStart

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

            // Pairing Confirm Characteristic (Write) - phone writes CONFIRMED, UNLINK, or START_SESSION
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

            // Add CCC Descriptor so the phone can subscribe to notifications
            val cccDescriptor = BluetoothGattDescriptor(
                CCC_DESCRIPTOR_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            @Suppress("DEPRECATION")
            cccDescriptor.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            respChar.addDescriptor(cccDescriptor)

            // Store reference for sending notifications later
            responseCharacteristic = respChar

            service.addCharacteristic(nameChar)
            service.addCharacteristic(codeChar)
            service.addCharacteristic(confirmChar)
            service.addCharacteristic(respChar)

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

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(BLE_SERVICE_UUID))
                .build()

            advertiser?.startAdvertising(settings, data, advertiseCallback)
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
            Log.d(TAG, "GATT server and advertising stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping GATT server", e)
        }
    }
}
