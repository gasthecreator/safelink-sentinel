// app/services/storage/HealthMonitor.js
// Tracks mesh network health (peer reliability, sync backlog) for AlertManager + UI

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAllPeers } from "./PeerCache.js";

const HEALTH_HISTORY_KEY = "@safelink_health_history";
const MAX_HISTORY = 50;

class HealthMonitor {
  constructor() {
    this.lastSnapshot = null;
  }

  // Collect a fresh health snapshot from current peer/sync state
  async collect() {
    try {
      const peers = await getAllPeers();
      const peerCount = peers.length;

      const avgRssi =
        peerCount > 0
          ? peers.reduce((sum, p) => sum + (p.rssi || -100), 0) / peerCount
          : -100;

      // crude sync lag proxy: how many peers look stale (no timestamp in last 2 min)
      const now = Date.now();
      const staleCount = peers.filter((p) => {
        if (!p.timestamp) return true;
        return now - new Date(p.timestamp).getTime() > 120000;
      }).length;
      const syncLag = staleCount;

      let reliabilityScore = "Good";
      if (peerCount === 0 || avgRssi <= -90) {
        reliabilityScore = "Critical";
      } else if (avgRssi <= -75 || staleCount > peerCount / 2) {
        reliabilityScore = "Degraded";
      }

      const successRate = Math.max(
        0,
        Math.min(100, Math.round(((avgRssi + 100) / 70) * 100))
      );

      const snapshot = {
        peerCount,
        avgRssi: Number(avgRssi.toFixed(1)),
        syncLag,
        reliabilityScore,
        successRate,
        timestamp: new Date().toISOString(),
      };

      this.lastSnapshot = snapshot;
      await this.recordHistory(snapshot);

      return snapshot;
    } catch (err) {
      console.error("[SafeLink][HealthMonitor] ❌ Error collecting health:", err);
      return {
        peerCount: 0,
        avgRssi: -100,
        syncLag: 0,
        reliabilityScore: "Critical",
        successRate: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async recordHistory(snapshot) {
    try {
      const raw = await AsyncStorage.getItem(HEALTH_HISTORY_KEY);
      const history = raw ? JSON.parse(raw) : [];
      history.push(snapshot);
      while (history.length > MAX_HISTORY) history.shift();
      await AsyncStorage.setItem(HEALTH_HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error("[SafeLink][HealthMonitor] ❌ Error saving history:", err);
    }
  }

  async getHistory() {
    try {
      const raw = await AsyncStorage.getItem(HEALTH_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }
}

export default new HealthMonitor();
