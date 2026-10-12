// app/services/mesh/NodeDiscovery.js
// Finds nearby SafeLink nodes over BLE and advertises this one.
//
//   scan    -> devices advertising SERVICE_UUID (react-native-ble-plx)
//   resolve -> connect once, read the node's public profile, verify its ID is
//              derived from its signing key, remember it as a peer
//   advertise -> native peripheral module (see BleTransport)

import { Platform, PermissionsAndroid } from "react-native";
import { storePeer, removeOldPeers } from "../storage/PeerCache.js";
import IdentityManager from "../crypto/IdentityManager.js";
import { getBleManager } from "../ble/bleManager.js";
import BleTransport from "../ble/BleTransport.js";
import { SERVICE_UUID } from "../ble/BleProtocol.js";

let WifiP2pManager = null;
try {
  if (Platform.OS !== "web") {
    WifiP2pManager = require("react-native-wifi-p2p").default;
  }
} catch (error) {
  console.log("[NodeDiscovery] Wi-Fi P2P module not available");
}

const PEER_TTL_MS = 90 * 1000; // a peer unseen for this long drops off the live list
const PROFILE_REFRESH_MS = 60 * 1000; // re-read a known device's profile at most this often
const MAX_HANDSHAKES_PER_SCAN = 8;
const BLUETOOTH_READY_WAIT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class NodeDiscovery {
  constructor() {
    this.peerMap = new Map(); // node id -> peer
    this.bleToPeer = new Map(); // BLE address -> { id, resolvedAt }
    this.listeners = [];
    this.deviceId = null; // set in init() from IdentityManager
    this.scanTimeout = 10000;
    this.ready = false; // permissions granted and Bluetooth powered on
    this.scanning = false;
    this.tracking = false; // a dedicated signal-strength scan is running (see startTracking)
    this.autoTimer = null;
  }

  /** True when a real BLE stack is present (false on web and in builds without it). */
  get bleAvailable() {
    return !!getBleManager();
  }

  // Ask for the runtime permissions this Android version actually has.
  // BLUETOOTH_SCAN/CONNECT/ADVERTISE only exist on Android 12+ (API 31); before
  // that, BLE scanning is gated by ACCESS_FINE_LOCATION.
  async requestAndroidPermissions() {
    const P = PermissionsAndroid.PERMISSIONS;
    const modern = Platform.Version >= 31;
    const required = modern ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
    // Advertising is optional: without it we can still scan and send.
    const optional = modern ? [P.BLUETOOTH_ADVERTISE, P.ACCESS_FINE_LOCATION] : [];

    const granted = await PermissionsAndroid.requestMultiple([...required, ...optional]);
    const missing = required.filter((perm) => granted[perm] !== PermissionsAndroid.RESULTS.GRANTED);
    if (missing.length > 0) {
      console.log(
        `⚠️ Bluetooth permission denied (API ${Platform.Version}): ${missing.join(", ")}`
      );
      return false;
    }
    if (modern && granted[P.BLUETOOTH_ADVERTISE] !== PermissionsAndroid.RESULTS.GRANTED) {
      console.log("[SafeLink] ⚠️ Advertise permission denied - this node can scan but not be found.");
    }
    return true;
  }

  // Wi-Fi Direct is optional; BLE works without it. On Android 13+ it needs the
  // NEARBY_WIFI_DEVICES runtime permission (before that it relies on the location
  // permission already granted for BLE scanning).
  async initWifiP2p() {
    if (!WifiP2pManager || !WifiP2pManager.initialize) return;
    try {
      if (Platform.Version >= 33) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
        );
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          console.log("[SafeLink] Wi-Fi Direct skipped: nearby Wi-Fi devices permission denied.");
          return;
        }
      }
      await WifiP2pManager.initialize();
    } catch (err) {
      console.log("[SafeLink] Wi-Fi P2P unavailable, continuing with BLE only:", err?.message);
    }
  }

  async waitForBluetooth(manager) {
    const deadline = Date.now() + BLUETOOTH_READY_WAIT_MS;
    let state = await manager.state();
    while (state !== "PoweredOn" && Date.now() < deadline) {
      await sleep(500);
      state = await manager.state();
    }
    return state;
  }

  // Initialize Bluetooth & Wi-Fi services
  async init() {
    console.log("[SafeLink] Initializing NodeDiscovery...");
    this.deviceId = await IdentityManager.getDeviceId();

    const manager = getBleManager();
    if (!manager) {
      console.log("[SafeLink] BLE not available (web/unsupported build) - simulation only");
      return;
    }

    try {
      if (Platform.OS === "android") {
        if (!(await this.requestAndroidPermissions())) return;
        await this.initWifiP2p();
      }

      const state = await this.waitForBluetooth(manager);
      if (state !== "PoweredOn") {
        console.log(`⚠️ Bluetooth is not enabled (state: ${state}). Please turn it on.`);
        return;
      }

      this.ready = true;
      await this.advertisePresence();
      console.log("[SafeLink] NodeDiscovery initialized ✅");
    } catch (err) {
      console.error("❌ Initialization error:", err);
    }
  }

  // Development-only stand-in for builds with no BLE stack. Never used when
  // real BLE is present, and its peers are flagged so nothing mistakes them for real nodes.
  async simulateDiscovery() {
    console.log("[SafeLink] 🔁 Simulating discovery (no BLE stack)...");
    const now = new Date().toISOString();
    const fakePeers = [
      { id: "sim-alpha", name: "Alpha Node", rssi: -45, distance: "1.0" },
      { id: "sim-bravo", name: "Bravo Node", rssi: -60, distance: "3.8" },
      { id: "sim-charlie", name: "Charlie Node", rssi: -75, distance: "9.2" },
    ].map((p) => ({ ...p, type: "BLE", simulated: true, timestamp: now }));

    fakePeers.forEach((peer) => {
      this.peerMap.set(peer.id, peer);
      this.notifyListeners(peer);
    });
    return fakePeers;
  }

  // Scan for SafeLink nodes, then resolve each new one's identity.
  async startDiscovery() {
    console.log("[SafeLink] Starting device discovery...");

    const manager = getBleManager();
    if (!manager) return this.simulateDiscovery();
    if (!this.ready) {
      console.log("[SafeLink] Discovery skipped: Bluetooth not ready (permissions or power).");
      return this.getPeers();
    }
    if (this.scanning || this.tracking) return this.getPeers();

    this.scanning = true;
    try {
      const found = await this.scan(manager);
      await this.resolveCandidates(found);
      await removeOldPeers(2);
      console.log(`[SafeLink] Discovery finished ⏹️. ${this.getPeers().length} peers.`);
    } catch (err) {
      console.error("Discovery failed:", err);
    } finally {
      this.scanning = false;
    }
    return this.getPeers();
  }

  // Collect advertising SafeLink devices for one scan window.
  async scan(manager) {
    const found = new Map(); // BLE address -> { rssi, name }
    manager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.log("❌ BLE Scan error:", error.message);
        return;
      }
      if (device?.id) found.set(device.id, { rssi: device.rssi, name: device.name });
    });
    try {
      await sleep(this.scanTimeout);
    } finally {
      // Don't stop a tracking scan that took over the radio while this one was running.
      if (!this.tracking) manager.stopDeviceScan();
    }
    return found;
  }

  async resolveCandidates(found) {
    const now = Date.now();
    let handshakes = 0;
    for (const [bleId, info] of found) {
      const known = this.bleToPeer.get(bleId);
      const peer = known && this.peerMap.get(known.id);
      if (peer && now - known.resolvedAt < PROFILE_REFRESH_MS) {
        await this.upsertPeer({ ...peer, rssi: info.rssi }); // still here; refresh signal strength
        continue;
      }
      if (handshakes >= MAX_HANDSHAKES_PER_SCAN) continue;
      handshakes += 1;
      try {
        const profile = await BleTransport.readProfile(bleId);
        if (profile.id === this.deviceId) continue; // our own advertisement
        this.bleToPeer.set(bleId, { id: profile.id, resolvedAt: now });
        await this.upsertPeer(this.buildPeer(profile, bleId, info));
      } catch (err) {
        console.log(`[SafeLink] Could not resolve ${bleId}: ${err.message}`);
      }
    }
  }

  buildPeer(profile, bleId, info) {
    // Rough distance (m) from RSSI using a log-distance model at -69 dBm @ 1 m.
    const distance = info.rssi ? Math.pow(10, (-69 - info.rssi) / 20).toFixed(2) : "N/A";
    return {
      id: profile.id,
      bleId,
      name: info.name || `Node ${profile.id.slice(0, 6)}`,
      rssi: info.rssi,
      distance,
      type: "BLE",
      sign: profile.sign,
      box: profile.box,
      timestamp: new Date().toISOString(),
    };
  }

  async upsertPeer(peer) {
    const fresh = { ...peer, timestamp: new Date().toISOString() };
    const isNew = !this.peerMap.has(fresh.id);
    this.peerMap.set(fresh.id, fresh);
    await storePeer(fresh);
    this.notifyListeners(fresh);
    if (isNew) {
      console.log(
        `[SafeLink] ✅ Peer found: ${fresh.name} (${fresh.id.slice(0, 8)}) | RSSI: ${fresh.rssi} | ~${fresh.distance}m`
      );
    }
  }

  /** The peer with this node ID if it was seen recently, else null. */
  getPeer(id) {
    const peer = this.peerMap.get(id);
    if (!peer || peer.simulated) return null;
    return new Date(peer.timestamp).getTime() >= Date.now() - PEER_TTL_MS ? peer : null;
  }

  /**
   * Follow one phone's Bluetooth signal strength, for the "find them" screen.
   * Scans continuously (reporting every advertisement, which the normal scan
   * does not) and calls onSample(rssi) each time that phone is heard. The normal
   * discovery cycle is paused meanwhile because two scans fight over the radio.
   * Returns a function that stops tracking, or null if the phone isn't known or
   * Bluetooth isn't usable.
   */
  startTracking(peerId, onSample) {
    const manager = getBleManager();
    const peer = this.getPeer(peerId);
    if (!manager || !this.ready || !peer || !peer.bleId) return null;
    if (this.tracking) this.stopTracking();

    this.tracking = true; // makes the normal discovery cycle step aside
    manager.stopDeviceScan();
    const LOW_LATENCY = 2; // react-native-ble-plx ScanMode.LowLatency
    manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: true, scanMode: LOW_LATENCY },
      (error, device) => {
        if (error) {
          console.log("[SafeLink] Tracking scan error:", error.message);
          return;
        }
        if (device && device.id === peer.bleId && typeof device.rssi === "number") onSample(device.rssi);
      }
    );
    return () => this.stopTracking();
  }

  stopTracking() {
    if (!this.tracking) return;
    this.tracking = false;
    getBleManager()?.stopDeviceScan();
  }

  // Rescan on an interval so the peer list tracks who is actually nearby.
  startAutoDiscovery(intervalMs = 30000) {
    if (this.autoTimer || !this.bleAvailable) return;
    const tick = () => this.startDiscovery().catch(() => {});
    tick();
    this.autoTimer = setInterval(tick, intervalMs);
  }

  stopAutoDiscovery() {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = null;
  }

  // Listen for peer discoveries in real time
  onPeerDiscovered(callback) {
    if (typeof callback === "function") {
      this.listeners.push(callback);
    }
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  notifyListeners(peer) {
    this.listeners.forEach((cb) => cb(peer));
  }

  // Start advertising this node so others can find it. Returns this node's ID.
  async advertisePresence() {
    this.deviceId = this.deviceId || (await IdentityManager.getDeviceId());
    const advertising = await BleTransport.start();
    console.log(
      `[SafeLink] ${advertising ? "Advertising" : "Not advertising"} as ${this.deviceId.slice(0, 8)}`
    );
    return this.deviceId;
  }

  // Peers seen recently (stale ones age out of the live list)
  getPeers() {
    const cutoff = Date.now() - PEER_TTL_MS;
    return [...this.peerMap.values()].filter(
      (p) => p.simulated || new Date(p.timestamp).getTime() >= cutoff
    );
  }

  // Log session analytics
  logSession() {
    const peers = this.getPeers();
    const totalPeers = peers.length;
    const avgRSSI =
      totalPeers > 0
        ? (peers.reduce((sum, p) => sum + (p.rssi || 0), 0) / totalPeers).toFixed(2)
        : 0;

    console.log(`[SafeLink] Session Summary → Peers: ${totalPeers}, Avg RSSI: ${avgRSSI}`);

    return { totalPeers, avgRSSI, timestamp: new Date().toISOString() };
  }

  // Stop scanning and cleanup
  async stop() {
    this.stopAutoDiscovery();
    this.stopTracking();
    getBleManager()?.stopDeviceScan();
    await BleTransport.stop();
    console.log("[SafeLink] NodeDiscovery stopped and cleaned up.");
  }
}

export default new NodeDiscovery();
