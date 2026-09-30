// app/services/mesh/GeoBroadcast.js
// Extended with priority tiers + multi-hop geo routing

import { getAllPeers, storePeer } from "../storage/PeerCache.js";
import MessageRelay from "./MessageRelay.js";

const EARTH_RADIUS_KM = 6371;
function toRad(deg) { return (deg * Math.PI) / 180; }
function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

class GeoBroadcast {
  constructor() {
    // avoid infinite re-broadcasts
    this.relayHistory = new Set();
  }

  filterPeersByRadius(peers, center, radiusKm) {
    if (!center || radiusKm == null) return peers;
    const valid = peers.filter(p => typeof p.lat === "number" && typeof p.lon === "number");
    if (valid.length === 0) return peers;

    return valid.filter(p => distanceKm(center, p) <= radiusKm);
  }

  // sort peers by message priority
  sortPeersByPriority(peers, priority) {
    if (priority === "critical" || priority === "high") {
      // nearest peers first for speed
      return peers.sort((a, b) => (a.rssi || -70) - (b.rssi || -70));
    }
    // randomize order for load balancing
    return peers.sort(() => 0.5 - Math.random());
  }

  // base broadcast with optional radius + priority
  async broadcast(senderId, content, options = {}) {
    const {
      center = null,
      radiusKm = null,
      priority = "normal",
      extraMeta = {},
      hopsLeft = 1, // for multi-hop re-broadcast
    } = options;

    const allPeers = await getAllPeers();
    if (!allPeers || allPeers.length === 0) {
      console.log("[SafeLink][Geo] ❌ No peers available for broadcast.");
      return { totalTargets: 0, success: 0, failed: 0 };
    }

    // high-priority messages ignore radius filter
    const targetList =
      priority === "critical"
        ? allPeers
        : this.filterPeersByRadius(allPeers, center, radiusKm);

    const peers = this.sortPeersByPriority(targetList, priority);
    console.log(
      `[SafeLink][Geo] 📣 Broadcasting "${priority.toUpperCase()}" message to ${peers.length} peers...`
    );

    let success = 0, failed = 0;
    for (const peer of peers) {
      try {
        const msg = await MessageRelay.createMessage(senderId, peer.id, content, {
          priority,
          hopsLeft,
          ...extraMeta,
        });
        const delivered = await MessageRelay.deliverWithRetry(msg);
        delivered ? success++ : failed++;
      } catch (err) {
        console.log(`[SafeLink][Geo] ❌ Error to ${peer.id}:`, err.message);
        failed++;
      }
    }

    const summary = { totalTargets: peers.length, success, failed };
    console.log("[SafeLink][Geo] ✅ Broadcast summary:", summary);
    return summary;
  }

  // standard radius helper
  async broadcastToRadius(senderId, content, center, radiusKm, meta = {}, priority = "normal") {
    return this.broadcast(senderId, content, { center, radiusKm, priority, extraMeta: meta });
  }

  // broadcast to everyone (no filter)
  async broadcastToAll(senderId, content, meta = {}, priority = "normal") {
    return this.broadcast(senderId, content, { extraMeta: meta, priority });
  }

  // --- MULTI-HOP EXTENSION ---

  /**
   * Called by a peer when it receives a geo message.
   * If message has hopsLeft > 0, it rebroadcasts to neighbors within radius.
   */
  async relayReceivedGeoMessage(message, center, radiusKm = 50) {
    if (!message || !message.meta) return;
    const key = `${message.id}:${message.meta?.hopsLeft}`;
    if (this.relayHistory.has(key)) {
      console.log(`[SafeLink][Geo] 🔁 Already relayed ${message.id}, skipping.`);
      return;
    }
    this.relayHistory.add(key);

    const hopsLeft = (message.meta.hopsLeft || 1) - 1;
    if (hopsLeft <= 0) {
      console.log(`[SafeLink][Geo] 🛑 Hop limit reached for ${message.id}`);
      return;
    }

    console.log(
      `[SafeLink][Geo] 🌐 Re-broadcasting message ${message.id} with ${hopsLeft} hops left...`
    );

    await this.broadcast(message.senderId, message.meta.content || "Geo alert", {
      center,
      radiusKm,
      priority: message.meta.priority || "normal",
      extraMeta: { ...message.meta, hopsLeft },
      hopsLeft,
    });
  }
}

export default new GeoBroadcast();
