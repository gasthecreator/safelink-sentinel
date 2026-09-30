// app/services/mesh/NodeDiscovery.js

import { Platform, PermissionsAndroid } from "react-native";
import { storePeer } from "../storage/PeerCache.js";
import { v4 as uuidv4 } from "uuid";

// Conditional BLE manager (only on native platforms)
let BleManager = null;
let WifiP2pManager = null;
let bleManager = null;

try {
  if (Platform.OS !== "web") {
    BleManager = require("react-native-ble-plx").BleManager;
    WifiP2pManager = require("react-native-wifi-p2p").default;
    bleManager = new BleManager();
  }
} catch (error) {
  console.log("[NodeDiscovery] BLE/WiFi modules not available (web/emulator mode)");
}

class NodeDiscovery {
  constructor() {
    this.peers = [];
    this.listeners = []; // listeners for live updates
    this.deviceId = uuidv4(); // unique installation ID
    this.scanTimeout = 15000; // default scan duration
  }

  // Initialize Bluetooth & Wi-Fi services
  async init() {
    console.log("[SafeLink] Initializing NodeDiscovery...");
    
    // Web/emulator mode - use simulation
    if (Platform.OS === "web" || !bleManager) {
      console.log("[SafeLink] Web/emulator mode - simulation available");
      return;
    }
    
    try {
      // Request Bluetooth permissions (Android 12+)
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        if (
          granted["android.permission.BLUETOOTH_SCAN"] !==
            PermissionsAndroid.RESULTS.GRANTED ||
          granted["android.permission.BLUETOOTH_CONNECT"] !==
            PermissionsAndroid.RESULTS.GRANTED
        ) {
          console.log("⚠️ Bluetooth permission denied.");
          return;
        }

        if (WifiP2pManager && WifiP2pManager.initialize) {
          await WifiP2pManager.initialize();
        }
      }

      if (bleManager && bleManager.state) {
        const state = await bleManager.state();
        if (state !== "PoweredOn") {
          console.log("⚠️ Bluetooth is not enabled. Please turn it on.");
          return;
        }
      }

      console.log("[SafeLink] NodeDiscovery initialized ✅");
    } catch (err) {
      console.error("❌ Initialization error:", err);
      console.log("[SafeLink] Falling back to simulation mode");
    }
  }
  // Simulate peer discovery for web or emulator testing
    async simulateDiscovery() {
        console.log("[SafeLink] 🔁 Simulating discovery...");
    
        const fakePeers = [
        { id: "11:22:33:44:55:66", name: "Alpha Node", rssi: -45, distance: "1.0", type: "BLE", timestamp: new Date().toISOString() },
        { id: "77:88:99:AA:BB:CC", name: "Bravo Node", rssi: -60, distance: "3.8", type: "BLE", timestamp: new Date().toISOString() },
        { id: "DE:AD:BE:EF:FE:ED", name: "Charlie Node", rssi: -75, distance: "9.2", type: "BLE", timestamp: new Date().toISOString() },
        ];
    
        fakePeers.forEach((peer) => {
        this.peers.push(peer);
        this.notifyListeners(peer);
        });
    
        console.log(`[SafeLink] 🧠 Simulation complete (${fakePeers.length} peers).`);
        return fakePeers;
    }
    
  
  // Begin scanning for nearby peers
  async startDiscovery() {
    console.log("[SafeLink] Starting device discovery...");
    this.peers = []; // reset session

    // Web/emulator mode - use simulation
    if (Platform.OS === "web" || !bleManager) {
      console.log("[SafeLink] Using simulation mode for discovery");
      return this.simulateDiscovery();
    }

    try {
      if (!bleManager || !bleManager.startDeviceScan) {
        console.log("[SafeLink] BLE manager not available, using simulation");
        return this.simulateDiscovery();
      }

      bleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.log("❌ BLE Scan error:", error.message);
          return;
        }

        if (!device?.id) return;

        // Calculate estimated distance (in meters) from RSSI
        const distance = device.rssi
          ? Math.pow(10, ((-69 - device.rssi) / (10 * 2)))
          : null;

        const newPeer = {
          id: device.id,
          name: device.name || "Unknown Device",
          rssi: device.rssi,
          distance: distance ? distance.toFixed(2) : "N/A",
          type: "BLE",
          timestamp: new Date().toISOString(),
        };

        // Save unique peers
        if (!this.peers.find((p) => p.id === newPeer.id)) {
          this.peers.push(newPeer);
          storePeer(newPeer);
          this.notifyListeners(newPeer);
          console.log(
            `[SafeLink] ✅ Peer found: ${newPeer.name} (${newPeer.id}) | RSSI: ${
              newPeer.rssi
            } | ~${newPeer.distance}m`
          );
        }
      });

      // Stop scan after timeout
      setTimeout(() => {
        if (bleManager && bleManager.stopDeviceScan) {
          bleManager.stopDeviceScan();
        }
        console.log(
          `[SafeLink] Discovery stopped ⏹️. ${this.peers.length} peers found.`
        );
      }, this.scanTimeout);
    } catch (err) {
      console.error("Discovery failed:", err);
      // Fallback to simulation
      return this.simulateDiscovery();
    }
  }

  // Listen for peer discoveries in real time
  onPeerDiscovered(callback) {
    if (typeof callback === "function") {
      this.listeners.push(callback);
    }
  }

  notifyListeners(peer) {
    this.listeners.forEach((cb) => cb(peer));
  }

  // Broadcast your own presence
  async advertisePresence() {
    console.log(`[SafeLink] Broadcasting device ID: ${this.deviceId}`);
    // TODO: integrate native BLE advertiser or Wi-Fi Direct beacon
    return this.deviceId;
  }

  // Retrieve current peer list
  getPeers() {
    return this.peers;
  }

  // Log session analytics
  logSession() {
    const totalPeers = this.peers.length;
    const avgRSSI =
      totalPeers > 0
        ? (
            this.peers.reduce((sum, p) => sum + (p.rssi || 0), 0) / totalPeers
          ).toFixed(2)
        : 0;

    console.log(
      `[SafeLink] Session Summary → Peers: ${totalPeers}, Avg RSSI: ${avgRSSI}`
    );

    return { totalPeers, avgRSSI, timestamp: new Date().toISOString() };
  }

  // Stop scanning and cleanup
  async stop() {
    if (bleManager && bleManager.stopDeviceScan) {
      bleManager.stopDeviceScan();
    }
    console.log("[SafeLink] NodeDiscovery stopped and cleaned up.");
  }
}

export default new NodeDiscovery();

