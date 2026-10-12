// app/services/mesh/MeshManager.js

import NodeDiscovery from "./NodeDiscovery.js";
import MessageRelay from "./MessageRelay.js";
import GeoBroadcast from "./GeoBroadcast.js";
import SyncManager from "./SyncManager.js";
import AlertManager from "./AlertManager.js";
import HealthMonitor from "../storage/HealthMonitor.js";
import BleTransport from "../ble/BleTransport.js";
import Outbox from "./Outbox.js";
import { nowISO } from "../../utils/TimeUtils.js";

class MeshManager {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    console.log("[SafeLink][MeshManager] 🧩 Initializing mesh stack...");
    // Wire receive path first so nothing written to us while advertising is lost:
    // BLE frames -> verified message -> relay/inbox -> alerts
    BleTransport.onMessage((bytes) =>
      MessageRelay.receive(bytes).catch((err) =>
        console.log("[SafeLink][MeshManager] Receive failed:", err.message)
      )
    );
    MessageRelay.onMessageReceived((msg) =>
      AlertManager.handleIncoming(msg).catch((err) =>
        console.log("[SafeLink][MeshManager] Inbox failed:", err.message)
      )
    );
    await Outbox.init();
    // A peer coming into range is the moment waiting messages can go out.
    NodeDiscovery.onPeerDiscovered(() => Outbox.requestFlush());
    await NodeDiscovery.init?.();
    await SyncManager.initialize?.();
    await AlertManager.init();
    NodeDiscovery.startAutoDiscovery();
    this.initialized = true;
    console.log("[SafeLink][MeshManager] ✅ Mesh stack ready.");
  }

  // Discovery controls
  async scanOnce() {
    return NodeDiscovery.startDiscovery();
  }

  getPeers() {
    return NodeDiscovery.getPeers();
  }

  // Direct messaging
  async sendDirectMessage(senderId, receiverId, content, meta = {}) {
    await this.init();
    const msg = await MessageRelay.createMessage(senderId, receiverId, content, meta);
    await MessageRelay.deliverMessage(msg);
    return msg;
  }

  // Broadcast wrapper
  async broadcastAlert(senderId, content, options) {
    await this.init();
    return GeoBroadcast.broadcast(senderId, content, options);
  }

  // Relief wrapper
  async createReliefRequest(senderId, payload) {
    await this.init();
    return AlertManager.createReliefRequestAndAlert(senderId, payload);
  }

  async getOpenReliefRequests() {
    return AlertManager.getOpenReliefRequests();
  }

  // Everything the home screen lists: relief requests plus alerts from other nodes
  async getAlertFeed() {
    return AlertManager.getAlertFeed();
  }

  async getHealthSnapshot() {
    return HealthMonitor.collect();
  }

  async manualSync() {
    await SyncManager.startSync?.();
    return {
      timestamp: nowISO(),
      status: "ok",
    };
  }
}

export default new MeshManager();

