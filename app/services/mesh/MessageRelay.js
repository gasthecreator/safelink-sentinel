// app/services/mesh/MessageRelay.js

import { getAllPeers } from "../storage/PeerCache.js";
import { v4 as uuidv4 } from "uuid";
import Encryptor from "../crypto/Encryptor.js";
import IdentityManager from "../crypto/IdentityManager.js";
import RouterAI from "../ai/RouterAI.js";
import AnalyticsLogger from "../storage/AnalyticsLogger.js";
import MessageCache from "../storage/MessageCache.js"; // optional persistent store

// In-memory fallback queue
const messageQueue = [];

class MessageRelay {
  constructor() {
    this.queue = messageQueue;
    this.maxRetries = 3;
    this.retryDelay = 800; // ms between retries
    this.blacklist = new Set(); // peers that failed recently
  }

  // Create a new secure message
  async createMessage(senderId, receiverId, content, meta = {}) {
    try {
      const { payload, signature } = await IdentityManager.buildSignedMessage(content, meta);
      const encryptedContent = await Encryptor.encrypt(JSON.stringify(payload));

      const message = {
        id: uuidv4(),
        senderId,
        receiverId,
        encrypted: true,
        data: encryptedContent,
        signature,
        timestamp: new Date().toISOString(),
        status: "pending", // pending | delivered | failed
        hopCount: 0,
        retryCount: 0,
        meta,
      };

      this.queue.push(message);
      AnalyticsLogger.logPending(message);

      // Persist for crash safety
      if (MessageCache?.storeMessage) await MessageCache.storeMessage(message);

      console.log(`[SafeLink] 📨 Created secure message (${content})`);
      return message;
    } catch (err) {
      console.error("[SafeLink] ❌ Failed to create message:", err.message);
    }
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

    if (!receiver || this.blacklist.has(receiver.id)) {
      console.log(`[SafeLink] 🚫 Receiver unavailable or blacklisted (${message.receiverId})`);
      message.status = "failed";
      AnalyticsLogger.logDelivery(message, false, receiver);
      RouterAI.recordResult(message.receiverId, false);
      this.blacklist.add(message.receiverId);
      return false;
    }

    // Simulate network latency / delivery window
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 200));

    message.hopCount += 1;
    message.status = "delivered";

    // Decrypt to verify
    const decrypted = await Encryptor.decrypt(message.data);
    const parsed = decrypted ? JSON.parse(decrypted) : { content: "[unreadable]" };

    console.log(`[SafeLink] ✅ Delivered: "${parsed.content}" → ${receiver.name}`);

    AnalyticsLogger.logDelivery(message, true, receiver);
    RouterAI.recordResult(message.receiverId, true);

    // Persist new state
    if (MessageCache?.updateMessage) await MessageCache.updateMessage(message);

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
        if (MessageCache?.updateMessage) await MessageCache.updateMessage(message);
        return false;
      }
    }
    return message.status === "delivered";
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
