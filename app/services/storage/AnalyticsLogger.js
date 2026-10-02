// app/services/storage/AnalyticsLogger.js
// Lightweight delivery analytics for MessageRelay

import AsyncStorage from "@react-native-async-storage/async-storage";

const ANALYTICS_KEY = "@safelink_message_analytics";
const MAX_EVENTS = 200;

class AnalyticsLogger {
  constructor() {
    this.events = [];
  }

  async _append(event) {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_KEY);
      const stored = raw ? JSON.parse(raw) : [];
      stored.push(event);
      while (stored.length > MAX_EVENTS) stored.shift();
      await AsyncStorage.setItem(ANALYTICS_KEY, JSON.stringify(stored));
    } catch (err) {
      console.error("[SafeLink][AnalyticsLogger] ❌ Error persisting event:", err);
    }
  }

  logPending(message) {
    console.log(`[SafeLink][AnalyticsLogger] ⏳ Pending: ${message.id}`);
    this._append({
      type: "pending",
      messageId: message.id,
      receiverId: message.receiverId,
      timestamp: new Date().toISOString(),
    });
  }

  logDelivery(message, success, peer) {
    console.log(
      `[SafeLink][AnalyticsLogger] ${success ? "✅" : "❌"} Delivery: ${message.id} → ${
        peer?.name || message.receiverId || "unknown"
      }`
    );
    this._append({
      type: "delivery",
      messageId: message.id,
      receiverId: message.receiverId,
      peerName: peer?.name || null,
      success,
      hopCount: message.hopCount,
      retryCount: message.retryCount,
      timestamp: new Date().toISOString(),
    });
  }

  async getEvents() {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async clear() {
    this.events = [];
    try {
      await AsyncStorage.removeItem(ANALYTICS_KEY);
    } catch (err) {
      console.error("[SafeLink][AnalyticsLogger] ❌ Error clearing analytics:", err);
    }
  }
}

export default new AnalyticsLogger();
