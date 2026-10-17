// app/services/mesh/MessageRelay.js
// Sends signed (and, for direct messages, encrypted) envelopes to nearby nodes
// over BLE, receives and verifies envelopes from them, and relays what it
// receives onward so messages can travel beyond one hop.

import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { isVerified } from "./peerTrust.js";

// In-memory outgoing queue
const messageQueue = [];

const PEER_BACKOFF_MS = 30 * 1000; // after a failed send, leave that peer alone for a while
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SEEN_LIMIT = 1000;
const SEEN_STORAGE_KEY = "@safelink_seen";
const SEEN_SAVE_DELAY_MS = 2000;
// Checking a signature is the expensive part of receiving. Anyone nearby can send as many validly
// signed messages as they like (a new key costs nothing), so the number of messages looked at is
// capped: a burst is fine, a sustained flood is dropped instead of draining the battery.
const RECEIVE_BURST = 30;
const RECEIVE_REFILL_PER_S = 2;

class MessageRelay {
  constructor() {
    this.queue = messageQueue;
    this.maxRetries = 3;
    this.retryDelay = 800; // ms between retries
    this.peerBackoff = new Map(); // peer id -> time we may try it again
    this.seen = new Map(); // "sender:id" -> true, insertion-ordered for eviction
    this.receivedListeners = [];
    this.seenLoaded = null;
    this.seenTimer = null;
    this.tokens = RECEIVE_BURST;
    this.tokensAt = Date.now();
    this.lastDropLog = 0;
  }

  // Messages are remembered by sender AND id. An id alone is chosen by whoever sends, so someone
  // who saw a real message's id go by could send their own message with that id first and make
  // this phone throw the real one away as a duplicate.
  seenKey(from, id) {
    return `${from}:${id}`;
  }

  markSeen(from, id) {
    this.seen.set(this.seenKey(from, id), true);
    if (this.seen.size > SEEN_LIMIT) {
      this.seen.delete(this.seen.keys().next().value);
    }
    clearTimeout(this.seenTimer);
    this.seenTimer = setTimeout(() => this.saveSeen(), SEEN_SAVE_DELAY_MS);
  }

  // Remembered across restarts, so closing and reopening the app does not make a recorded
  // (genuinely signed) alert look new again.
  loadSeen() {
    if (!this.seenLoaded) {
      this.seenLoaded = AsyncStorage.getItem(SEEN_STORAGE_KEY)
        .then((raw) => {
          const list = raw ? JSON.parse(raw) : [];
          if (Array.isArray(list)) for (const key of list.slice(-SEEN_LIMIT)) if (typeof key === "string") this.seen.set(key, true);
        })
        .catch(() => {});
    }
    return this.seenLoaded;
  }

  async saveSeen() {
    try {
      await AsyncStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...this.seen.keys()]));
    } catch {
      // not being able to save only costs us the restart protection
    }
  }

  /** Forget everything held in memory (used when the person erases their data). */
  reset() {
    clearTimeout(this.seenTimer);
    this.seenTimer = null;
    this.seen.clear();
    this.seenLoaded = Promise.resolve(); // nothing left in storage to load
    this.queue.length = 0;
    this.peerBackoff.clear();
  }

  /** True if there is budget to look at another incoming message. */
  takeReceiveToken(now = Date.now()) {
    this.tokens = Math.min(RECEIVE_BURST, this.tokens + ((now - this.tokensAt) / 1000) * RECEIVE_REFILL_PER_S);
    this.tokensAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
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
      this.markSeen(envelope.from, id); // don't process our own message if it echoes back

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

    // A direct message is meant for ONE person. Hand it only to a device that has proved it holds that person's
    // key; a device that merely advertises their (public, copyable) profile could swallow it.
    if (message.envelope.type === "direct" && !isVerified(receiver)) {
      console.log(`[SafeLink] 🔒 Not sending to ${receiver.name}: this device has not proved it is who it says it is`);
      message.status = "failed";
      message.failureReason = "unverified";
      AnalyticsLogger.logDelivery(message, false, receiver);
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
    if (!this.takeReceiveToken()) {
      if (Date.now() - this.lastDropLog > 10000) {
        this.lastDropLog = Date.now();
        console.log("[SafeLink] 🚫 Receiving too many messages too fast: dropping some");
      }
      return null;
    }
    const env = decodeEnvelope(bytes);
    // Cheap checks first; the signature is only checked for messages that could be accepted.
    if (!env || typeof env.id !== "string" || typeof env.from !== "string" || typeof env.ts !== "string") {
      console.log("[SafeLink] 🚫 Dropped a malformed message");
      return null;
    }
    await this.loadSeen();
    if (this.seen.has(this.seenKey(env.from, env.id))) return null;

    const age = Date.now() - Date.parse(env.ts);
    if (!(age > -MAX_CLOCK_SKEW_MS && age < MAX_MESSAGE_AGE_MS)) {
      console.log(`[SafeLink] 🚫 Dropped message ${env.id.slice(0, 8)} with implausible timestamp`);
      return null;
    }
    if (!verifyEnvelope(env)) {
      console.log("[SafeLink] 🚫 Dropped message that failed verification");
      return null;
    }
    this.markSeen(env.from, env.id);

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
