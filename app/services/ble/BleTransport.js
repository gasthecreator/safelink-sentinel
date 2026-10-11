// app/services/ble/BleTransport.js
// Moves SafeLink envelopes between phones over BLE.
//   central role    (react-native-ble-plx): connect to a peer, read its identity,
//                   write framed messages to it
//   peripheral role (native SafeLinkPeripheral): advertise, accept framed writes
// GATT connections are serialized: one operation at a time keeps the radio
// predictable on both platforms.

import { getBleManager } from "./bleManager.js";
import BlePeripheral from "./BlePeripheral.js";
import IdentityManager from "../crypto/IdentityManager.js";
import {
  SERVICE_UUID,
  MESSAGE_CHAR_UUID,
  IDENTITY_CHAR_UUID,
  DEFAULT_MTU,
  Reassembler,
  encodeFrames,
} from "./BleProtocol.js";
import { base64ToBytes, bytesToBase64, utf8Decode } from "./codec.js";

const CONNECT_TIMEOUT_MS = 10000;
const REQUESTED_MTU = 185;
const OPERATION_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class BleTransport {
  constructor() {
    this.reassembler = new Reassembler();
    this.handlers = [];
    this.started = false;
    this.writeSubscription = null;
    this.chain = Promise.resolve();
  }

  /** Central role needs the BLE manager; peripheral role needs the native module. */
  get available() {
    return !!getBleManager();
  }

  get advertising() {
    return BlePeripheral.state === "advertising";
  }

  /** cb(messageBytes, { centralId }) once a whole message has been reassembled. */
  onMessage(cb) {
    this.handlers.push(cb);
  }

  /**
   * Start receiving and advertising. Safe to call repeatedly. Advertising can
   * fail (Bluetooth off, permission denied, no hardware support) without
   * breaking the central role, so that is reported rather than thrown.
   */
  async start() {
    if (!this.writeSubscription) {
      this.writeSubscription = BlePeripheral.onWrite(({ centralId, bytes }) => {
        const message = this.reassembler.push(centralId, bytes);
        if (message) this.handlers.forEach((cb) => cb(message, { centralId }));
      });
    }
    if (!BlePeripheral.linked) {
      console.log("[SafeLink][BLE] Native peripheral module not linked - receive-only off");
      return false;
    }
    if (this.advertising) return true;
    try {
      const profile = await IdentityManager.getPublicProfile();
      await BlePeripheral.start(profile);
      this.started = true;
      return true;
    } catch (error) {
      console.log(`[SafeLink][BLE] Not advertising: ${error.message}`);
      return false;
    }
  }

  async stop() {
    this.writeSubscription?.remove();
    this.writeSubscription = null;
    await BlePeripheral.stop().catch(() => {});
    this.started = false;
  }

  /** Run `task` after every previously queued GATT operation has finished. */
  enqueue(task) {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => {});
    return run;
  }

  async _connect(bleId) {
    const manager = getBleManager();
    if (!manager) throw new Error("BLE not available");
    const options = { timeout: CONNECT_TIMEOUT_MS, requestMTU: REQUESTED_MTU };
    const device = await manager.connectToDevice(bleId, options);
    return device.discoverAllServicesAndCharacteristics();
  }

  async _disconnect(bleId) {
    try {
      await getBleManager()?.cancelDeviceConnection(bleId);
    } catch {
      // already disconnected
    }
  }

  /** Connect to a scanned device and read + validate its public profile. */
  readProfile(bleId) {
    return this.enqueue(() =>
      withTimeout(this._readProfile(bleId), OPERATION_TIMEOUT_MS, "Profile read").catch(
        async (error) => {
          await this._disconnect(bleId); // a timeout leaves the connection open
          throw error;
        }
      )
    );
  }

  async _readProfile(bleId) {
    try {
      const device = await this._connect(bleId);
      const characteristic = await device.readCharacteristicForService(
        SERVICE_UUID,
        IDENTITY_CHAR_UUID
      );
      if (!characteristic?.value) throw new Error("Empty identity");
      const profile = JSON.parse(utf8Decode(base64ToBytes(characteristic.value)));
      if (!IdentityManager.isValidProfile(profile)) throw new Error("Invalid identity");
      return profile;
    } finally {
      await this._disconnect(bleId);
    }
  }

  /** Deliver a whole message (bytes) to a peer. Resolves on success, throws otherwise. */
  send(peer, bytes) {
    if (!peer?.bleId) return Promise.reject(new Error("Peer has no BLE address"));
    return this.enqueue(() =>
      withTimeout(this._send(peer, bytes), OPERATION_TIMEOUT_MS, "Send").catch(async (error) => {
        await this._disconnect(peer.bleId);
        throw error;
      })
    );
  }

  async _send(peer, bytes) {
    try {
      const device = await this._connect(peer.bleId);
      const mtu = device.mtu || DEFAULT_MTU;
      const frames = encodeFrames(bytes, mtu);
      for (const frame of frames) {
        // With-response writes: the peer's GATT server acknowledges every frame.
        await device.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          MESSAGE_CHAR_UUID,
          bytesToBase64(frame)
        );
      }
      console.log(
        `[SafeLink][BLE] Sent ${bytes.length}B to ${peer.id.slice(0, 6)} in ${frames.length} frame(s), MTU ${mtu}`
      );
    } finally {
      await this._disconnect(peer.bleId);
    }
  }
}

export default new BleTransport();
