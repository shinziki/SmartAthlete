package com.example.smartathlete.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid
import android.util.Log
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * BleGattServerManager
 *
 * Runs a BLE GATT peripheral server on the Wear OS watch.
 * Advertises the SmartAthlete pairing service and allows the mobile phone
 * to connect, read the pairing code/device name, and confirm pairing.
 */
class BleGattServerManager(private val context: Context) {

    companion object {
        private const val TAG = "BleGattServer"

        val BLE_SERVICE_UUID: UUID = UUID.fromString("0000FFAA-0000-1000-8000-00805F9B34FB")
        val DEVICE_NAME_CHAR_UUID: UUID = UUID.fromString("0000FFB1-0000-1000-8000-00805F9B34FB")
        val PAIRING_CODE_CHAR_UUID: UUID = UUID.fromString("0000FFB2-0000-1000-8000-00805F9B34FB")
        val PAIRING_CONFIRM_CHAR_UUID: UUID = UUID.fromString("0000FFB3-0000-1000-8000-00805F9B34FB")
    }

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null

    private var currentPairingCode: String = "849215"
    private var onPairingConfirmedListener: ((String?) -> Unit)? = null

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
                device,
                requestId,
                characteristic,
                preparedWrite,
                responseNeeded,
                offset,
                value
            )

            if (characteristic.uuid == PAIRING_CONFIRM_CHAR_UUID) {
                val confirmStr = value?.let { String(it, StandardCharsets.UTF_8) } ?: ""
                Log.d(TAG, "Received pairing confirmation from mobile: $confirmStr")

                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }

                // Notify UI that pairing is complete with confirmation string
                onPairingConfirmedListener?.invoke(confirmStr)
            } else {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun startServer(pairingCode: String, onConfirmed: (String?) -> Unit): Boolean {
        currentPairingCode = pairingCode
        onPairingConfirmedListener = onConfirmed

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

            // Pairing Confirm Characteristic (Write)
            val confirmChar = BluetoothGattCharacteristic(
                PAIRING_CONFIRM_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )

            service.addCharacteristic(nameChar)
            service.addCharacteristic(codeChar)
            service.addCharacteristic(confirmChar)

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
            Log.d(TAG, "GATT server and advertising stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping GATT server", e)
        }
    }
}
