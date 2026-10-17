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
  encodeChallenge,
  decodeControl,
} from "./BleProtocol.js";
import { newNonce, signProof, verifyProof } from "../crypto/PeerProof.js";
import { base64ToBytes, bytesToBase64, utf8Decode } from "./codec.js";

const PROOF_READ_ATTEMPTS = 4;
const PROOF_READ_DELAY_MS = 250;
const MAX_CHALLENGES_PER_MINUTE = 30; // answering costs one signature; a flood of challenges must not become a drain
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
    this.challengeTimes = [];
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
        const control = decodeControl(bytes);
        if (control) {
          this.answerChallenge(control).catch((err) => console.log("[SafeLink][BLE] Could not answer a challenge:", err.message));
          return;
        }
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

  /**
   * Someone nearby asked us to prove who we are: sign their nonce and publish it with our profile, where they
   * will read it back. The profile stays as it was; only `proof` is added.
   */
  async answerChallenge({ nonce }) {
    const now = Date.now();
    this.challengeTimes = this.challengeTimes.filter((t) => now - t < 60000);
    if (this.challengeTimes.length >= MAX_CHALLENGES_PER_MINUTE) return;
    this.challengeTimes.push(now);
    const profile = await IdentityManager.getPublicProfile();
    const proof = await signProof(nonce);
    await BlePeripheral.updateIdentity({ ...profile, proof });
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

  async _readIdentity(device) {
    const characteristic = await device.readCharacteristicForService(SERVICE_UUID, IDENTITY_CHAR_UUID);
    if (!characteristic?.value) throw new Error("Empty identity");
    return JSON.parse(utf8Decode(base64ToBytes(characteristic.value)));
  }

  /**
   * Read the identity, then challenge the device to prove it holds that identity's key. Returns the profile with
   * `verified: true` only if it did. A phone running an older build cannot answer: it comes back unverified, and
   * that is not an error (it can still send and relay alerts; it just is not trusted with direct messages).
   */
  async _readProfile(bleId) {
    try {
      const device = await this._connect(bleId);
      const profile = await this._readIdentity(device);
      if (!IdentityManager.isValidProfile(profile)) throw new Error("Invalid identity");
      const { proof: _ignored, ...plain } = profile;

      let verified = false;
      try {
        const nonce = newNonce();
        await device.writeCharacteristicWithResponseForService(SERVICE_UUID, MESSAGE_CHAR_UUID, bytesToBase64(encodeChallenge(nonce)));
        for (let attempt = 0; attempt < PROOF_READ_ATTEMPTS && !verified; attempt++) {
          await new Promise((r) => setTimeout(r, PROOF_READ_DELAY_MS));
          const again = await this._readIdentity(device);
          // it must be the same identity, answering this very challenge
          verified = again.id === plain.id && again.sign === plain.sign && again.box === plain.box && verifyProof(plain, nonce, again.proof);
        }
      } catch (error) {
        console.log(`[SafeLink][BLE] Could not verify ${bleId}: ${error.message}`);
      }
      return { ...plain, verified };
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
