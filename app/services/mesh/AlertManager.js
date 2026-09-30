// app/services/mesh/AlertManager.js
// AI-driven alerts + relief / donation requests

import GeoBroadcast from "./GeoBroadcast.js";
import SyncManager from "../../../services/storage/SyncManager.js";
import HealthMonitor from "../../../services/storage/HealthMonitor.js";
import MessageRelay from "./MessageRelay.js";
import RouterAI from "../../../services/ai/RouterAI.js";
import ReliefRequestStore from "../../../services/storage/ReliefRequestStore.js";
import { v4 as uuidv4 } from "uuid";

class AlertManager {
  constructor() {
    this.alertHistory = [];
    this.activeAlerts = [];
    this.alertInterval = 15000; // 15s health check
    this.autoMode = true;
  }

  async init() {
    console.log("[SafeLink][AlertManager] 🚨 Starting alert monitor...");
    this.monitorHealthLoop();
    await ReliefRequestStore.init();
  }

  // ===== AUTO ALERTS BASED ON HEALTH =====

  async monitorHealthLoop() {
    setInterval(async () => {
      if (!this.autoMode) return;

      const health = await HealthMonitor.collect();

      if (health.reliabilityScore === "Critical") {
        console.log(
          "[SafeLink][AlertManager] ⚠️ Critical network degradation detected!"
        );
        await this.triggerAutoAlert({
          type: "network_failure",
          message: "Connectivity failure detected in your area.",
          priority: "critical",
          radiusKm: 50,
        });
      }

      if (health.syncLag > 10) {
        console.log("[SafeLink][AlertManager] 🕒 Message backlog detected!");
        await this.triggerAutoAlert({
          type: "sync_backlog",
          message: "Mesh congestion detected. Delays possible.",
          priority: "high",
          radiusKm: 20,
        });
      }
    }, this.alertInterval);
  }

  // ===== MANUAL ALERT =====

  async sendManualAlert(
    senderId,
    message,
    category = "general",
    priority = "normal",
    center = null,
    radiusKm = 30
  ) {
    console.log(`[SafeLink][AlertManager] 📢 Manual alert: ${message}`);

    const alert = {
      id: `alert-${Date.now()}`,
      type: category,
      message,
      priority,
      center,
      radiusKm,
      senderId,
      timestamp: new Date().toISOString(),
    };

    const summary = await GeoBroadcast.broadcast(senderId, message, {
      center,
      radiusKm,
      priority,
      extraMeta: { category },
    });

    this.logAlert(alert, summary);
    return summary;
  }

  // ===== AUTO ALERT =====

  async triggerAutoAlert({ type, message, priority, radiusKm }) {
    const senderId = "system-auto";
    const center = RouterAI.getNodeLocation?.() || null;

    const alert = {
      id: `auto-${Date.now()}`,
      type,
      message,
      priority,
      radiusKm,
      center,
      timestamp: new Date().toISOString(),
    };

    console.log(`[SafeLink][AlertManager] 🤖 Auto-triggered alert: ${message}`);

    const summary = await GeoBroadcast.broadcast(senderId, message, {
      center,
      radiusKm,
      priority,
      extraMeta: { type, auto: true },
    });

    this.logAlert(alert, summary);
    return summary;
  }

  // ===== RELIEF / DONATION REQUESTS =====

  /**
   * Create a relief request and broadcast it as an alert.
   * payload should include:
   *  - type: "medical" | "food" | "shelter" | ...
   *  - title, description
   *  - items: [{ name, qty, unit }]
   *  - amountNeeded, currency (optional)
   *  - location: { lat, lon, address? }
   *  - priority: "critical" | "high" | "normal" | "low"
   *  - radiusKm: broadcast radius
   */
  async createReliefRequestAndAlert(senderId, payload) {
    const {
      type = "general",
      title = "Relief request",
      description = "",
      items = [],
      amountNeeded = null,
      currency = "USD",
      location = null,
      priority = "high",
      radiusKm = 30,
    } = payload;

    const id = uuidv4();
    const request = {
      id,
      requesterId: senderId,
      type,
      title,
      description,
      items,
      amountNeeded,
      currency,
      location,
      priority,
      status: "open", // open | partial | fulfilled | expired
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      linkedAlertId: null,
    };

    await ReliefRequestStore.createRequest(request);

    // Build alert message text
    const text = `[RELIEF] ${title} - ${type.toUpperCase()}\n` +
      `${description}\n` +
      (amountNeeded
        ? `Requested value: ${amountNeeded} ${currency}\n`
        : "") +
      (items.length
        ? `Key items: ${items.map((i) => `${i.name} x${i.qty}${i.unit || ""}`).join(", ")}`
        : "");

    const center = location ? { lat: location.lat, lon: location.lon } : null;

    const summary = await GeoBroadcast.broadcast(senderId, text, {
      center,
      radiusKm,
      priority,
      extraMeta: { type: "relief", reliefId: id },
    });

    const alertRecord = {
      id: `relief-${Date.now()}`,
      type: `relief_${type}`,
      message: text,
      priority,
      center,
      radiusKm,
      senderId,
      timestamp: new Date().toISOString(),
      reliefId: id,
    };

    request.linkedAlertId = alertRecord.id;
    await ReliefRequestStore.updateStatus(id, "open"); // ensure updatedAt

    this.logAlert(alertRecord, summary);

    return { request, summary };
  }

  async getOpenReliefRequests() {
    return ReliefRequestStore.getOpenRequests();
  }

  async markReliefStatus(id, status) {
    // status: "open" | "partial" | "fulfilled" | "expired"
    return ReliefRequestStore.updateStatus(id, status);
  }

  // ===== ALERT LOGGING & REPORTS =====

  logAlert(alert, summary) {
    const record = {
      ...alert,
      success: summary.success,
      failed: summary.failed,
      totalTargets: summary.totalTargets,
    };
    this.alertHistory.push(record);
    this.activeAlerts.push(record);
    console.log("[SafeLink][AlertManager] ✅ Alert logged:", record);
  }

  getRecentAlerts(limit = 5) {
    return this.alertHistory.slice(-limit);
  }

  printActiveAlerts() {
    console.log("\n🚨 Active Alerts");
    console.log("─────────────────────────────────────");
    if (this.activeAlerts.length === 0) {
      console.log("  No active alerts.");
      return;
    }
    console.table(
      this.activeAlerts.map((a) => ({
        Type: a.type,
        Priority: a.priority,
        Message: a.message.slice(0, 60) + (a.message.length > 60 ? "..." : ""),
        Time: new Date(a.timestamp).toLocaleTimeString(),
        Targets: `${a.success}/${a.totalTargets}`,
      }))
    );
  }

  clearResolvedAlerts() {
    this.activeAlerts = [];
    console.log("[SafeLink][AlertManager] 🧹 Cleared active alerts.");
  }

  disableAuto() {
    this.autoMode = false;
    console.log("[SafeLink][AlertManager] 🛑 Auto alert mode disabled.");
  }

  enableAuto() {
    this.autoMode = true;
    console.log("[SafeLink][AlertManager] 🤖 Auto alert mode enabled.");
  }
}

export default new AlertManager();
