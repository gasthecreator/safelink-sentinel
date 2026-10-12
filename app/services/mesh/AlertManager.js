// app/services/mesh/AlertManager.js
// AI-driven alerts + relief / donation requests

import GeoBroadcast from "./GeoBroadcast.js";
import HealthMonitor from "../storage/HealthMonitor.js";
import MessageRelay from "./MessageRelay.js";
import RouterAI from "../ai/RouterAI.js";
import ReliefRequestStore from "../storage/ReliefRequestStore.js";
import { v4 as uuidv4 } from "uuid";
import { sanitizePosition, sanitizeText } from "../location/position.js";

class AlertManager {
  constructor() {
    this.alertHistory = [];
    this.activeAlerts = [];
    this.alertInterval = 15000; // 15s health check
    this.autoAlertCooldown = 10 * 60 * 1000; // re-notify at most every 10 min while a condition persists
    this.autoMode = true;
    this.incomingAlerts = []; // alerts received from other nodes (non-relief)
    this.healthTimer = null;
    this.checking = false;
    this.conditionState = new Map(); // alert type -> timestamp of last auto alert while condition holds
  }

  async init() {
    console.log("[SafeLink][AlertManager] 🚨 Starting alert monitor...");
    this.monitorHealthLoop();
    await ReliefRequestStore.init();
  }

  // ===== AUTO ALERTS BASED ON HEALTH =====

  monitorHealthLoop() {
    if (this.healthTimer) return; // already running (init() can be called more than once)
    this.healthTimer = setInterval(() => this.checkHealth(), this.alertInterval);
  }

  async checkHealth() {
    if (!this.autoMode || this.checking) return; // skip overlapping runs
    this.checking = true;
    try {
      const health = await HealthMonitor.collect();

      await this.evaluateCondition(health.reliabilityScore === "Critical", {
        type: "network_failure",
        message: "Connectivity failure detected in your area.",
        priority: "critical",
        radiusKm: 50,
      });

      await this.evaluateCondition(health.syncLag > 10, {
        type: "sync_backlog",
        message: "Mesh congestion detected. Delays possible.",
        priority: "high",
        radiusKm: 20,
      });
    } catch (err) {
      console.error("[SafeLink][AlertManager] ❌ Health check failed:", err);
    } finally {
      this.checking = false;
    }
  }

  // Fire an auto alert when a condition starts, then at most once per cooldown
  // while it persists. When it clears, drop its active alert so it can fire again.
  async evaluateCondition(isActive, alert) {
    const lastFired = this.conditionState.get(alert.type);

    if (!isActive) {
      if (lastFired !== undefined) {
        this.conditionState.delete(alert.type);
        this.activeAlerts = this.activeAlerts.filter((a) => a.type !== alert.type);
        console.log(`[SafeLink][AlertManager] ✅ Condition cleared: ${alert.type}`);
      }
      return;
    }

    if (lastFired !== undefined && Date.now() - lastFired < this.autoAlertCooldown) {
      return;
    }

    console.log(`[SafeLink][AlertManager] ⚠️ Condition detected: ${alert.type}`);
    this.conditionState.set(alert.type, Date.now());
    await this.triggerAutoAlert(alert);
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
      store: false, // automatic status alerts go only to whoever is in range now
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
   *  - location: the sender's position { latitude, longitude, accuracyM, fixedAt }
   *    (optional; the request still goes out without it)
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
      where = null,
    } = payload;

    const position = sanitizePosition(location);
    const whereNote = sanitizeText(where);
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
      location: position,
      where: whereNote,
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

    const summary = await GeoBroadcast.broadcast(senderId, text, {
      radiusKm,
      priority,
      position,
      where: whereNote,
      extraMeta: { type: "relief", reliefId: id },
    });

    const alertRecord = {
      id: `relief-${Date.now()}`,
      type: `relief_${type}`,
      message: text,
      priority,
      center: null,
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

  // ===== INCOMING (from other nodes) =====

  // Turn a verified message received over the mesh into something the UI shows.
  async handleIncoming(msg) {
    const firstLine = String(msg.content || "").split("\n")[0];
    const priority = msg.meta?.priority || "normal";
    // Never trust a position from the network: it is validated, or dropped.
    const position = sanitizePosition(msg.meta?.position);
    const where = sanitizeText(msg.meta?.where);

    if (msg.meta?.type === "relief") {
      const id = msg.meta.reliefId || msg.id;
      if (!(await ReliefRequestStore.getRequest(id))) {
        await ReliefRequestStore.createRequest({
          id,
          requesterId: msg.from,
          type: "relief",
          title: firstLine.replace(/^\[RELIEF\]\s*/, "") || "Relief request",
          description: msg.content,
          items: [],
          priority,
          status: "open",
          createdAt: msg.sentAt,
          updatedAt: msg.receivedAt,
          location: position,
          where,
          remote: true,
        });
      }
      return;
    }

    this.incomingAlerts.unshift({
      id: `in-${msg.id}`,
      title: firstLine || "Alert",
      description: msg.content,
      priority,
      senderId: msg.from,
      timestamp: msg.receivedAt,
      location: position,
      where,
      remote: true,
    });
    this.incomingAlerts = this.incomingAlerts.slice(0, 50);
    console.log(`[SafeLink][AlertManager] 📥 Alert from ${msg.from.slice(0, 8)}: ${firstLine}`);
  }

  // Open relief requests (ours and received) plus received alerts, newest first.
  async getAlertFeed() {
    const relief = await ReliefRequestStore.getOpenRequests();
    return [...relief, ...this.incomingAlerts].sort(
      (a, b) =>
        new Date(b.updatedAt || b.timestamp || 0).getTime() -
        new Date(a.updatedAt || a.timestamp || 0).getTime()
    );
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
