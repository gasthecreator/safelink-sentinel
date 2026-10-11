// app/services/ble/BlePeripheral.js
// JS wrapper around the native SafeLinkPeripheral module (Kotlin GATT server on
// Android, Swift CBPeripheralManager on iOS). Advertises this node and receives
// frames written by nearby nodes.

import { NativeModules, NativeEventEmitter } from "react-native";
import { SERVICE_UUID, MESSAGE_CHAR_UUID, IDENTITY_CHAR_UUID } from "./BleProtocol.js";
import { bytesToBase64, base64ToBytes, utf8Encode } from "./codec.js";

const native = NativeModules.SafeLinkPeripheral || null;
const emitter = native ? new NativeEventEmitter(native) : null;

class BlePeripheral {
  constructor() {
    this.state = native ? "stopped" : "unavailable";
    this.detail = null;
    this.stateListeners = [];
    if (emitter) {
      emitter.addListener("SafeLinkPeripheralState", ({ state, detail }) => {
        this.state = state;
        this.detail = detail || null;
        console.log(`[SafeLink][BLE] Peripheral state: ${state}${detail ? ` (${detail})` : ""}`);
        this.stateListeners.forEach((cb) => cb(state, detail));
      });
    }
  }

  /** True when the native module is linked into this build. */
  get linked() {
    return !!native;
  }

  async isSupported() {
    if (!native) return false;
    try {
      return !!(await native.isSupported());
    } catch {
      return false;
    }
  }

  /** Begin advertising and serving GATT. `profile` is this node's public profile. */
  async start(profile) {
    if (!native) throw new Error("SafeLinkPeripheral native module not linked");
    const identity = bytesToBase64(utf8Encode(JSON.stringify(profile)));
    await native.start(SERVICE_UUID, MESSAGE_CHAR_UUID, IDENTITY_CHAR_UUID, identity);
  }

  async stop() {
    if (native) await native.stop();
  }

  /** cb({ centralId, bytes }) for every frame a remote node writes to us. */
  onWrite(cb) {
    if (!emitter) return { remove() {} };
    return emitter.addListener("SafeLinkPeripheralWrite", ({ centralId, value }) => {
      try {
        cb({ centralId, bytes: base64ToBytes(value) });
      } catch (err) {
        console.log("[SafeLink][BLE] Dropped undecodable write:", err.message);
      }
    });
  }

  onState(cb) {
    this.stateListeners.push(cb);
    return {
      remove: () => {
        this.stateListeners = this.stateListeners.filter((fn) => fn !== cb);
      },
    };
  }
}

export default new BlePeripheral();
