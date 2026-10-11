package com.safelink.mesh

import android.Manifest
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
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/**
 * BLE peripheral role for SafeLink: advertises the SafeLink service and runs a
 * GATT server so other nodes can (a) read this node's public identity and
 * (b) write framed messages to it. The central role (scan/connect/write) is
 * handled in JS by react-native-ble-plx.
 *
 * JS API (NativeModules.SafeLinkPeripheral):
 *   isSupported(): Promise<boolean>
 *   start(serviceUuid, messageCharUuid, identityCharUuid, identityBase64): Promise<void>
 *   updateIdentity(identityBase64): Promise<void>
 *   stop(): Promise<void>
 * Events: SafeLinkPeripheralWrite {centralId, value(base64)}, SafeLinkPeripheralState {state, detail?}
 */
class SafeLinkPeripheralModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var identity: ByteArray = ByteArray(0)
  private var serviceUuid: UUID? = null
  private var messageCharUuid: UUID? = null
  private var identityCharUuid: UUID? = null
  private var pendingStart: Promise? = null

  override fun getName() = "SafeLinkPeripheral"

  private val adapter: BluetoothAdapter?
    get() = (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun hasPermission(permission: String) =
      ContextCompat.checkSelfPermission(reactContext, permission) == PackageManager.PERMISSION_GRANTED

  /** Android 12+ needs ADVERTISE + CONNECT at runtime; earlier versions use install-time permissions. */
  private fun missingPermission(): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)) return "BLUETOOTH_ADVERTISE"
      if (!hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) return "BLUETOOTH_CONNECT"
    }
    return null
  }

  private fun emit(event: String, params: com.facebook.react.bridge.WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, params)
  }

  private fun emitState(state: String, detail: String? = null) {
    val map = Arguments.createMap()
    map.putString("state", state)
    if (detail != null) map.putString("detail", detail)
    emit("SafeLinkPeripheralState", map)
  }

  @ReactMethod
  fun isSupported(promise: Promise) {
    val a = adapter
    val pm = reactContext.packageManager
    promise.resolve(
        a != null &&
            pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) &&
            a.isMultipleAdvertisementSupported)
  }

  @SuppressLint("MissingPermission") // checked by missingPermission() before any call
  @ReactMethod
  fun start(serviceUuid: String, messageCharUuid: String, identityCharUuid: String, identityBase64: String, promise: Promise) {
    val a = adapter
    if (a == null || !reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      emitState("unsupported", "no_ble")
      promise.reject("unsupported", "Bluetooth LE is not available on this device")
      return
    }
    missingPermission()?.let {
      emitState("unauthorized", it)
      promise.reject("permission", "Missing permission: $it")
      return
    }
    if (!a.isEnabled) {
      emitState("poweredOff")
      promise.reject("bluetooth_off", "Bluetooth is turned off")
      return
    }
    val le = a.bluetoothLeAdvertiser
    if (le == null || !a.isMultipleAdvertisementSupported) {
      emitState("unsupported", "no_advertising")
      promise.reject("unsupported", "This device cannot advertise over BLE")
      return
    }

    stopInternal()

    try {
      this.serviceUuid = UUID.fromString(serviceUuid)
      this.messageCharUuid = UUID.fromString(messageCharUuid)
      this.identityCharUuid = UUID.fromString(identityCharUuid)
      this.identity = Base64.decode(identityBase64, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      promise.reject("bad_args", e.message)
      return
    }

    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val server = manager.openGattServer(reactContext, gattCallback)
    if (server == null) {
      promise.reject("gatt_server", "Could not open GATT server")
      return
    }
    gattServer = server
    advertiser = le
    pendingStart = promise

    val service = BluetoothGattService(this.serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(
        BluetoothGattCharacteristic(
            this.messageCharUuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE))
    service.addCharacteristic(
        BluetoothGattCharacteristic(
            this.identityCharUuid,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ))
    // Advertising begins in onServiceAdded once the service is registered.
    if (!server.addService(service)) {
      pendingStart = null
      stopInternal()
      promise.reject("gatt_server", "Could not register GATT service")
    }
  }

  @SuppressLint("MissingPermission")
  private fun startAdvertising() {
    val le = advertiser ?: return
    val settings =
        AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .setTimeout(0)
            .build()
    // Flags (3 bytes) + 128-bit service UUID (18 bytes) fit in one packet; no name.
    val data =
        AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(serviceUuid))
            .build()
    val callback =
        object : AdvertiseCallback() {
          override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            emitState("advertising")
            pendingStart?.resolve(null)
            pendingStart = null
          }

          override fun onStartFailure(errorCode: Int) {
            val reason =
                when (errorCode) {
                  ADVERTISE_FAILED_DATA_TOO_LARGE -> "data_too_large"
                  ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "too_many_advertisers"
                  ADVERTISE_FAILED_ALREADY_STARTED -> "already_started"
                  ADVERTISE_FAILED_INTERNAL_ERROR -> "internal_error"
                  ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "feature_unsupported"
                  else -> "error_$errorCode"
                }
            emitState("error", reason)
            pendingStart?.reject("advertise_failed", reason)
            pendingStart = null
            stopInternal()
          }
        }
    advertiseCallback = callback
    le.startAdvertising(settings, data, callback)
  }

  @ReactMethod
  fun updateIdentity(identityBase64: String, promise: Promise) {
    try {
      identity = Base64.decode(identityBase64, Base64.NO_WRAP)
      promise.resolve(null)
    } catch (e: IllegalArgumentException) {
      promise.reject("bad_args", e.message)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    stopInternal()
    emitState("stopped")
    promise.resolve(null)
  }

  @SuppressLint("MissingPermission")
  private fun stopInternal() {
    try {
      advertiseCallback?.let { advertiser?.stopAdvertising(it) }
    } catch (_: Exception) {}
    advertiseCallback = null
    try {
      gattServer?.close()
    } catch (_: Exception) {}
    gattServer = null
    advertiser = null
  }

  override fun invalidate() {
    stopInternal()
    super.invalidate()
  }

  // Required by RN's NativeEventEmitter on the JS side.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  private val gattCallback =
      object : BluetoothGattServerCallback() {
        @SuppressLint("MissingPermission")
        override fun onServiceAdded(status: Int, service: BluetoothGattService) {
          if (status == BluetoothGatt.GATT_SUCCESS) {
            startAdvertising()
          } else {
            emitState("error", "service_add_$status")
            pendingStart?.reject("gatt_server", "Service registration failed: $status")
            pendingStart = null
            stopInternal()
          }
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
          val server = gattServer ?: return
          if (characteristic.uuid != identityCharUuid) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null)
            return
          }
          if (offset > identity.size) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
            return
          }
          // Long reads arrive as repeated requests with increasing offsets.
          server.sendResponse(
              device, requestId, BluetoothGatt.GATT_SUCCESS, offset,
              identity.copyOfRange(offset, identity.size))
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
          val server = gattServer ?: return
          val ok = characteristic.uuid == messageCharUuid && !preparedWrite && offset == 0 && value != null
          if (ok) {
            val map = Arguments.createMap()
            map.putString("centralId", device.address)
            map.putString("value", Base64.encodeToString(value, Base64.NO_WRAP))
            emit("SafeLinkPeripheralWrite", map)
          }
          if (responseNeeded) {
            server.sendResponse(
                device, requestId,
                if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED,
                offset, null)
          }
        }
      }
}
