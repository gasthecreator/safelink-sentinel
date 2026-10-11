import CoreBluetooth
import Foundation

/// BLE peripheral role for SafeLink: advertises the SafeLink service and runs a
/// GATT server so other nodes can (a) read this node's public identity and
/// (b) write framed messages to it. The central role (scan/connect/write) is
/// handled in JS by react-native-ble-plx.
///
/// JS API (NativeModules.SafeLinkPeripheral):
///   isSupported(): Promise<boolean>
///   start(serviceUuid, messageCharUuid, identityCharUuid, identityBase64): Promise<void>
///   updateIdentity(identityBase64): Promise<void>
///   stop(): Promise<void>
/// Events: SafeLinkPeripheralWrite {centralId, value(base64)}, SafeLinkPeripheralState {state, detail?}
@objc(SafeLinkPeripheral)
class SafeLinkPeripheral: RCTEventEmitter, CBPeripheralManagerDelegate {
  private let queue = DispatchQueue(label: "com.safelink.mesh.peripheral")
  private var manager: CBPeripheralManager?
  private var hasListeners = false

  private var serviceUUID: CBUUID?
  private var messageCharUUID: CBUUID?
  private var identityCharUUID: CBUUID?
  private var identity = Data()

  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var wantsStart = false

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["SafeLinkPeripheralWrite", "SafeLinkPeripheralState"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ name: String, _ body: [String: Any]) {
    if hasListeners { sendEvent(withName: name, body: body) }
  }

  private func emitState(_ state: String, _ detail: String? = nil) {
    var body: [String: Any] = ["state": state]
    if let detail = detail { body["detail"] = detail }
    emit("SafeLinkPeripheralState", body)
  }

  private func settle(error code: String?, _ message: String = "") {
    if let code = code {
      pendingReject?(code, message, nil)
    } else {
      pendingResolve?(nil)
    }
    pendingResolve = nil
    pendingReject = nil
  }

  // MARK: JS API

  @objc(isSupported:rejecter:)
  func isSupported(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(CBManager.authorization != .denied && CBManager.authorization != .restricted)
  }

  @objc(start:messageCharUuid:identityCharUuid:identityBase64:resolver:rejecter:)
  func start(
    _ serviceUuid: String, messageCharUuid: String, identityCharUuid: String,
    identityBase64: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = Data(base64Encoded: identityBase64) else {
      reject("bad_args", "identity is not valid base64", nil)
      return
    }
    queue.async {
      self.serviceUUID = CBUUID(string: serviceUuid)
      self.messageCharUUID = CBUUID(string: messageCharUuid)
      self.identityCharUUID = CBUUID(string: identityCharUuid)
      self.identity = data
      self.pendingResolve = resolve
      self.pendingReject = reject
      self.wantsStart = true

      if let manager = self.manager {
        // Already created: act on its current state.
        self.handle(state: manager.state, manager: manager)
      } else {
        // Creating the manager triggers the Bluetooth permission prompt on first use.
        self.manager = CBPeripheralManager(
          delegate: self, queue: self.queue,
          options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
      }
    }
  }

  @objc(updateIdentity:resolver:rejecter:)
  func updateIdentity(
    _ identityBase64: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = Data(base64Encoded: identityBase64) else {
      reject("bad_args", "identity is not valid base64", nil)
      return
    }
    queue.async {
      self.identity = data
      resolve(nil)
    }
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      self.wantsStart = false
      self.manager?.stopAdvertising()
      self.manager?.removeAllServices()
      self.emitState("stopped")
      resolve(nil)
    }
  }

  // MARK: CBPeripheralManagerDelegate

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    handle(state: peripheral.state, manager: peripheral)
  }

  private func handle(state: CBManagerState, manager: CBPeripheralManager) {
    switch state {
    case .poweredOn:
      if wantsStart { addService(to: manager) }
    case .poweredOff:
      emitState("poweredOff")
      settle(error: "bluetooth_off", "Bluetooth is turned off")
    case .unauthorized:
      emitState("unauthorized")
      settle(error: "permission", "Bluetooth permission was denied")
    case .unsupported:
      emitState("unsupported")
      settle(error: "unsupported", "This device cannot act as a BLE peripheral")
    default:
      break  // .unknown / .resetting: wait for the next update
    }
  }

  private func addService(to manager: CBPeripheralManager) {
    guard let serviceUUID = serviceUUID, let messageUUID = messageCharUUID,
      let identityUUID = identityCharUUID
    else { return }

    manager.stopAdvertising()
    manager.removeAllServices()

    let messageChar = CBMutableCharacteristic(
      type: messageUUID, properties: [.write, .writeWithoutResponse], value: nil,
      permissions: [.writeable])
    // value: nil keeps it dynamic so reads are answered per request, honouring offsets
    let identityChar = CBMutableCharacteristic(
      type: identityUUID, properties: [.read], value: nil, permissions: [.readable])

    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [messageChar, identityChar]
    manager.add(service)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let error = error {
      emitState("error", "service_add")
      settle(error: "gatt_server", error.localizedDescription)
      return
    }
    guard let serviceUUID = serviceUUID else { return }
    // Local name is deliberately omitted: iOS limits advertising payloads, and
    // when the app is backgrounded the service UUID moves to an overflow area
    // that only scanners filtering on that UUID (as SafeLink does) can see.
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID]])
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    if let error = error {
      emitState("error", "advertise_failed")
      settle(error: "advertise_failed", error.localizedDescription)
    } else {
      emitState("advertising")
      settle(error: nil)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard request.characteristic.uuid == identityCharUUID else {
      peripheral.respond(to: request, withResult: .requestNotSupported)
      return
    }
    guard request.offset <= identity.count else {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    // Long reads arrive as repeated requests with increasing offsets.
    request.value = identity.subdata(in: request.offset..<identity.count)
    peripheral.respond(to: request, withResult: .success)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    var allValid = true
    for request in requests {
      if request.characteristic.uuid == messageCharUUID, request.offset == 0, let value = request.value {
        emit(
          "SafeLinkPeripheralWrite",
          [
            "centralId": request.central.identifier.uuidString,
            "value": value.base64EncodedString(),
          ])
      } else {
        allValid = false
      }
    }
    // One response answers the whole batch (and is ignored for write-without-response).
    if let first = requests.first {
      peripheral.respond(to: first, withResult: allValid ? .success : .requestNotSupported)
    }
  }
}
