// app/services/privacy/DataWipe.js
// Erasing what this phone has stored about its owner: saved places, alerts and messages received or
// waiting to be sent, road reports, nearby devices, logs. Settings (units, voice) and downloaded maps
// stay; they are not personal. Optionally the phone's identity (its private keys) goes too, so it
// becomes a new device to everyone else.
//
// Memory is cleared BEFORE storage, so a save that is already queued cannot write the old data back.
// Every step is tried even if another fails, and the failures are reported rather than hidden.

import AsyncStorage from "@react-native-async-storage/async-storage";

/** Everything personal. Not here on purpose: units, voice, "seen onboarding", and the downloaded maps. */
export const PERSONAL_KEYS = [
  "@safelink_seen",
  "@safelink_outbox",
  "@safelink_sync_queue",
  "@safelink_sync_status",
  "@safelink_places",
  "@safelink_peers",
  "safelink_rescue_events",
  "@safelink_relief_requests",
  "@safelink_message_cache",
  "@safelink_message_analytics",
  "@safelink_road_reports",
  "@safelink_health_history",
];

// The real services, looked up when needed so tests can supply their own.
function realModules() {
  return {
    relay: require("../mesh/MessageRelay.js").default,
    outbox: require("../mesh/Outbox.js").default,
    alerts: require("../mesh/AlertManager.js").default,
    sync: require("../mesh/SyncManager.js").default,
    roads: require("../roads/RoadReportStore.js").default,
    reliefStore: require("../storage/ReliefRequestStore.js").default,
    messageCache: require("../storage/MessageCache.js").default,
    analytics: require("../storage/AnalyticsLogger.js").default,
    rescue: require("../storage/RescueLogger.js").default,
    health: require("../storage/HealthMonitor.js").default,
    peers: require("../storage/PeerCache.js"),
    logs: require("../diagnostics/LogBuffer.js"),
    identity: require("../crypto/IdentityManager.js").default,
    transport: require("../ble/BleTransport.js").default,
  };
}

/**
 * @param {{resetIdentity?: boolean, storage?: object, modules?: object}} options
 * @returns {Promise<{removedKeys: number, failures: string[], identityReset: boolean}>}
 */
export async function eraseMyData({ resetIdentity = false, storage = AsyncStorage, modules = null } = {}) {
  const m = modules || realModules();
  const failures = [];
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      failures.push(`${label}: ${err && err.message ? err.message : err}`);
    }
  };

  // 1. memory first
  await attempt("messages in memory", async () => m.relay && m.relay.reset());
  await attempt("waiting messages in memory", async () => m.outbox && m.outbox.reset());
  await attempt("received alerts", async () => m.alerts && m.alerts.reset());
  await attempt("relief requests", async () => m.reliefStore && m.reliefStore.clearAll());
  await attempt("road reports", async () => m.roads && m.roads.clear());
  await attempt("sync queue", async () => m.sync && m.sync.clearQueue && m.sync.clearQueue());
  await attempt("message cache", async () => m.messageCache && m.messageCache.clear());
  await attempt("delivery log", async () => m.analytics && m.analytics.clear());
  await attempt("rescue log", async () => m.rescue && m.rescue.clear());
  await attempt("health history", async () => m.health && m.health.reset());
  await attempt("nearby devices", async () => m.peers && m.peers.clearPeers());
  await attempt("diagnostics log", async () => m.logs && m.logs.clearEntries());

  // 2. then storage, key by key, so one bad key does not stop the rest
  let removedKeys = 0;
  for (const key of PERSONAL_KEYS) {
    await attempt(`stored ${key}`, async () => {
      await storage.removeItem(key);
      removedKeys += 1;
    });
  }

  // 3. optionally the identity, and re-advertise as the new device
  let identityReset = false;
  if (resetIdentity) {
    await attempt("identity", async () => {
      await m.identity.reset();
      identityReset = true;
    });
    if (identityReset && m.transport && m.transport.stop && m.transport.start) {
      await attempt("bluetooth restart", async () => {
        await m.transport.stop();
        await m.transport.start();
      });
    }
  }
  return { removedKeys, failures, identityReset };
}
