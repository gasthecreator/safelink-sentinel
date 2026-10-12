// app/services/mesh/MessageRelay.js
// Sends signed (and, for direct messages, encrypted) envelopes to nearby nodes
// over BLE, receives and verifies envelopes from them, and relays what it
// receives onward so messages can travel beyond one hop.

import { getAllPeers } from "../storage/PeerCache.js";
import { v4 as uuidv4 } from "uuid";
import {
  createEnvelope,
  verifyEnvelope,
  openEnvelope,
  encodeEnvelope,
  decodeEnvelope,
} from "../crypto/Envelope.js";
import IdentityManager from "../crypto/IdentityManager.js";
import RouterAI from "../ai/RouterAI.js";
import AnalyticsLogger from "../storage/AnalyticsLogger.js";
import MessageCache from "../storage/MessageCache.js";
import BleTransport from "../ble/BleTransport.js";
import Outbox from "./Outbox.js";

// In-memory outgoing queue
const messageQueue = [];

const PEER_BACKOFF_MS = 30 * 1000; // after a failed send, leave that peer alone for a while
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SEEN_LIMIT = 1000;

class MessageRelay {
  constructor() {
    this.queue = messageQueue;
    this.maxRetries = 3;
    this.retryDelay = 800; // ms between retries
    this.peerBackoff = new Map(); // peer id -> time we may try it again
    this.seen = new Map(); // envelope id -> true, insertion-ordered for eviction
    this.receivedListeners = [];
  }

  markSeen(id) {
    this.seen.set(id, true);
    if (this.seen.size > SEEN_LIMIT) {
      this.seen.delete(this.seen.keys().next().value);
    }
  }

  // Create a new secure message. A receiverId makes it a direct, encrypted
  // message; without one it is a signed broadcast that any node may read.
  async createMessage(senderId, receiverId, content, meta = {}) {
    try {
      const id = uuidv4();
      let recipientBoxKey = null;
      if (receiverId) {
        const peers = await getAllPeers();
        recipientBoxKey = peers.find((p) => p.id === receiverId)?.box || null;
      }

      const envelope = await createEnvelope({
        id,
        content,
        meta,
        to: receiverId || null,
        recipientBoxKey,
      });
      this.markSeen(id); // don't process our own message if it echoes back

      const message = {
        id,
        senderId,
        receiverId, // next-hop peer to hand the envelope to
        encrypted: envelope.type === "direct",
        envelope,
        timestamp: envelope.ts,
        status: "pending", // pending | delivered | failed
        hopCount: 0,
        retryCount: 0,
        meta,
      };

      this.queue.push(message);
      AnalyticsLogger.logPending(message);

      // Persist for crash safety
      await MessageCache.storeMessage(message);

      console.log(`[SafeLink] 📨 Created ${envelope.type} message ${id.slice(0, 8)}`);
      return message;
    } catch (err) {
      console.error("[SafeLink] ❌ Failed to create message:", err.message);
    }
  }

  isBackedOff(peerId) {
    const until = this.peerBackoff.get(peerId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.peerBackoff.delete(peerId);
      return false;
    }
    return true;
  }

  // Try to deliver message once
  async deliverMessage(message) {
    const peers = await getAllPeers();

    if (!peers || peers.length === 0) {
      console.log("[SafeLink] ⚠️ No peers available for delivery.");
      message.status = "failed";
      AnalyticsLogger.logDelivery(message, false, null);
      return false;
    }

    const receiver = peers.find((p) => p.id === message.receiverId);

    if (!receiver || this.isBackedOff(receiver.id)) {
      console.log(`[SafeLink] 🚫 Receiver unavailable or backing off (${message.receiverId})`);
      message.status = "failed";
      AnalyticsLogger.logDelivery(message, false, receiver);
      RouterAI.recordResult(message.receiverId, false);
      return false;
    }

    try {
      await BleTransport.send(receiver, encodeEnvelope(message.envelope));
    } catch (err) {
      console.log(`[SafeLink] ❌ Send to ${receiver.name} failed: ${err.message}`);
      message.status = "failed";
      this.peerBackoff.set(receiver.id, Date.now() + PEER_BACKOFF_MS);
      AnalyticsLogger.logDelivery(message, false, receiver);
      RouterAI.recordResult(receiver.id, false);
      return false;
    }

    message.hopCount += 1;
    message.status = "delivered";
    this.peerBackoff.delete(receiver.id);
    console.log(`[SafeLink] ✅ Delivered ${message.id.slice(0, 8)} → ${receiver.name}`);

    AnalyticsLogger.logDelivery(message, true, receiver);
    RouterAI.recordResult(receiver.id, true);

    await MessageCache.updateMessage(message);
    return true;
  }

  // Delivery loop with retry + RouterAI
  async deliverWithRetry(message) {
    if (!message.receiverId) {
      const bestPeer = await RouterAI.selectBestPeer();
      if (!bestPeer) {
        console.log("[SafeLink] ❌ No peers available to assign.");
        message.status = "failed";
        AnalyticsLogger.logDelivery(message, false, null);
        return false;
      }
      message.receiverId = bestPeer.id;
    }

    while (message.retryCount < this.maxRetries && message.status !== "delivered") {
      const success = await this.deliverMessage(message);
      if (success) return true;

      message.retryCount += 1;
      console.log(`[SafeLink] 🔁 Retry ${message.retryCount}/${this.maxRetries} for ${message.id}`);
      await new Promise((res) => setTimeout(res, this.retryDelay * message.retryCount));

      if (message.retryCount >= this.maxRetries) {
        console.log(`[SafeLink] ❌ Max retries reached for ${message.id}`);
        message.status = "failed";
        AnalyticsLogger.logDelivery(message, false, null);
        await MessageCache.updateMessage(message);
        return false;
      }
    }
    return message.status === "delivered";
  }

  // ===== RECEIVE + RELAY =====

  /** cb(received) for every verified message addressed to us or broadcast. Returns an unsubscribe function. */
  onMessageReceived(cb) {
    this.receivedListeners.push(cb);
    return () => {
      this.receivedListeners = this.receivedListeners.filter((fn) => fn !== cb);
    };
  }

  /**
   * Handle the bytes of one complete message from a nearby node: verify,
   * de-duplicate, deliver to listeners if it's for us, and relay it onward.
   */
  async receive(bytes) {
    const env = decodeEnvelope(bytes);
    if (!verifyEnvelope(env)) {
      console.log("[SafeLink] 🚫 Dropped message that failed verification");
      return null;
    }
    if (this.seen.has(env.id)) return null;

    const age = Date.now() - Date.parse(env.ts);
    if (!(age > -MAX_CLOCK_SKEW_MS && age < MAX_MESSAGE_AGE_MS)) {
      console.log(`[SafeLink] 🚫 Dropped message ${env.id.slice(0, 8)} with implausible timestamp`);
      return null;
    }
    this.markSeen(env.id);

    const myId = await IdentityManager.getDeviceId();
    if (env.from === myId) return null;

    let received = null;
    const addressedToMe = env.type === "direct" && env.to === myId;
    if (env.type === "broadcast" || addressedToMe) {
      const opened = await openEnvelope(env);
      if (opened) {
        received = {
          id: env.id,
          from: env.from,
          to: env.to,
          type: env.type,
          content: opened.content,
          meta: opened.meta || {},
          sentAt: env.ts,
          receivedAt: new Date().toISOString(),
          hops: env.hops,
          status: "received",
        };
        await MessageCache.storeMessage(received);
        console.log(`[SafeLink] 📥 Received ${env.type} message ${env.id.slice(0, 8)} from ${env.from.slice(0, 8)}`);
        this.receivedListeners.forEach((cb) => cb(received));
      } else {
        console.log(`[SafeLink] ⚠️ Could not open message ${env.id.slice(0, 8)}`);
      }
    }

    // Everything not addressed to us is kept and relayed, now and to later arrivals.
    if (!addressedToMe) Outbox.addRelay(env).catch(() => {});
    return received;
  }

  // Retry all failed messages
  async retryFailedMessages() {
    const failed = this.queue.filter((m) => m.status === "failed");
    console.log(`[SafeLink] 🔁 Retrying ${failed.length} failed messages...`);
    for (const msg of failed) {
      msg.retryCount = 0;
      await this.deliverWithRetry(msg);
    }
  }

  // Clean up expired or old messages
  async pruneOldMessages(maxAgeHours = 12) {
    const now = Date.now();
    this.queue = this.queue.filter((m) => {
      const ageHours = (now - new Date(m.timestamp).getTime()) / 3600000;
      if (ageHours > maxAgeHours) {
        console.log(`[SafeLink] 🧹 Removing expired message ${m.id}`);
        return false;
      }
      return true;
    });
  }

  // Queue + metrics overview
  getQueueSummary() {
    console.table(
      this.queue.map((m) => ({
        ID: m.id,
        To: m.receiverId,
        Status: m.status,
        Retries: m.retryCount,
        Hops: m.hopCount,
        Encrypted: m.encrypted,
      }))
    );

    const stats = {
      total: this.queue.length,
      delivered: this.queue.filter((m) => m.status === "delivered").length,
      failed: this.queue.filter((m) => m.status === "failed").length,
      pending: this.queue.filter((m) => m.status === "pending").length,
    };
    console.log("[SafeLink] 📊 Queue Summary:", stats);
    return stats;
  }
}

export default new MessageRelay();
