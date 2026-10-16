// app/services/mesh/Outbox.js
// Store-and-forward for signed envelopes.
//
// A message created here (alert, relief request) or received from another node
// (to be relayed) is kept, and handed to every node that comes into range until
// it has reached all of them or expires. That is what lets a phone that arrives
// minutes later still get an alert, and lets a message hop past the sender's own
// radio range. Nothing is lost if nobody is nearby when it is created: it waits.
//
// Per message we remember which peers already got it, so a flush never re-sends.
// A send counts as delivered once the peer's GATT server acknowledged every frame.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { v4 as uuidv4 } from "uuid";
import { createEnvelope, encodeEnvelope, DEFAULT_TTL } from "../crypto/Envelope.js";
import BleTransport from "../ble/BleTransport.js";
import { getAllPeers } from "../storage/PeerCache.js";

const STORAGE_KEY = "@safelink_outbox";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // messages are dropped a day after they were created
const MAX_RECORDS = 200;
const MAX_RELAYED_PER_SENDER = 10; // so one sender cannot fill the store and push everyone else's out
const PEER_FRESH_MS = 3 * 60 * 1000; // only try peers seen this recently
const BACKOFF_MS = 30 * 1000; // after a failed send, leave that peer alone for a while
const FLUSH_INTERVAL_MS = 60 * 1000; // safety net in case a discovery event was missed
const FLUSH_DEBOUNCE_MS = 1500;

const PRIORITY_RANK = { critical: 3, high: 2, normal: 1, low: 0 };

function priorityOf(envelope) {
  if (envelope.type !== "broadcast") return PRIORITY_RANK.normal;
  try {
    const priority = JSON.parse(envelope.body)?.meta?.priority;
    return PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal;
  } catch {
    return PRIORITY_RANK.normal;
  }
}

// Records are keyed by sender and id: an id alone is chosen by whoever sends, and a message
// that reuses another's id must not displace or block it.
const keyOf = (envelope) => `${envelope.from}:${envelope.id}`;

class Outbox {
  constructor() {
    this.records = new Map(); // "sender:id" -> { id, envelope, origin, deliveredTo, addedAt, ephemeral }
    this.backoff = new Map(); // peer id -> time we may try it again
    this.loaded = null;
    this.flushing = null;
    this.rerun = false;
    this.intervalTimer = null;
    this.debounceTimer = null;
  }

  /** Load saved messages and start the periodic safety-net flush. Safe to call repeatedly. */
  init() {
    if (!this.loaded) {
      this.loaded = this.load().then(() => {
        if (!this.intervalTimer) {
          this.intervalTimer = setInterval(() => this.requestFlush(0), FLUSH_INTERVAL_MS);
        }
      });
    }
    return this.loaded;
  }

  async load() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      for (const record of saved) {
        if (record?.envelope?.id && record.envelope.from) {
          record.id = keyOf(record.envelope);
          this.records.set(record.id, record);
        }
      }
      this.prune();
      console.log(`[SafeLink][Outbox] Loaded ${this.records.size} waiting message(s)`);
    } catch (err) {
      console.log("[SafeLink][Outbox] Could not load saved messages:", err.message);
    }
  }

  async persist() {
    try {
      const keep = [...this.records.values()].filter((r) => !r.ephemeral);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch (err) {
      console.log("[SafeLink][Outbox] Could not save messages:", err.message);
    }
  }

  prune() {
    const now = Date.now();
    for (const [id, record] of this.records) {
      if (now - Date.parse(record.envelope.ts) > MAX_AGE_MS) this.records.delete(id);
    }
    if (this.records.size > MAX_RECORDS) {
      // Over the cap: shed relayed messages first, then the oldest of what's left.
      const ordered = [...this.records.values()].sort((a, b) => {
        if (a.origin !== b.origin) return a.origin === "relay" ? -1 : 1;
        return a.addedAt - b.addedAt;
      });
      for (const record of ordered.slice(0, this.records.size - MAX_RECORDS)) {
        this.records.delete(record.id);
      }
    }
  }

  /**
   * Create a signed broadcast and send it to everyone in range now and to
   * anyone who comes into range later (until it expires). With `store: false`
   * it is only sent to whoever is in range right now (used for automatic
   * status alerts, which would be noise if replayed to later arrivals).
   *
   * Returns { id, totalTargets, success, failed, queued }.
   */
  async publish(content, meta = {}, { ttl = DEFAULT_TTL, store = true } = {}) {
    await this.init();
    const envelope = await createEnvelope({ id: uuidv4(), content, meta, to: null, ttl });
    const id = keyOf(envelope);
    this.records.set(id, {
      id,
      envelope,
      origin: "self",
      deliveredTo: [],
      addedAt: Date.now(),
      ephemeral: !store,
    });
    this.prune();
    if (store) await this.persist();

    const result = await this.flush();
    // Count devices that got *this* message (a flush also sends older waiting ones).
    const record = this.records.get(id);
    const success = record ? record.deliveredTo.length : 0;
    if (!store) this.records.delete(id);

    return {
      id: envelope.id,
      totalTargets: result.targets,
      success,
      failed: Math.max(0, result.targets - success),
      queued: store,
    };
  }

  /**
   * Keep an envelope received from another node so it can be passed on to
   * nodes that are in range now or arrive later. Returns false if its hop
   * budget is already used up.
   */
  async addRelay(envelope) {
    await this.init();
    if (envelope.hops + 1 >= envelope.ttl) return false;
    const id = keyOf(envelope);
    if (this.records.has(id)) return true;
    // one sender's relayed messages are limited, oldest first, so a flood from one key cannot evict the rest
    const theirs = [...this.records.values()].filter((r) => r.origin === "relay" && r.envelope.from === envelope.from);
    if (theirs.length >= MAX_RELAYED_PER_SENDER) {
      theirs.sort((a, b) => a.addedAt - b.addedAt);
      for (const old of theirs.slice(0, theirs.length - MAX_RELAYED_PER_SENDER + 1)) this.records.delete(old.id);
    }
    this.records.set(id, {
      id,
      envelope,
      origin: "relay",
      deliveredTo: [],
      addedAt: Date.now(),
      ephemeral: false,
    });
    this.prune();
    await this.persist();
    this.requestFlush(0);
    return true;
  }

  /** Flush soon, collapsing bursts of requests (e.g. one discovery event per peer). */
  requestFlush(delay = FLUSH_DEBOUNCE_MS) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flush().catch((err) => console.log("[SafeLink][Outbox] Flush failed:", err.message));
    }, delay);
  }

  /** Send every waiting message to every in-range peer that doesn't have it yet. */
  flush() {
    if (this.flushing) {
      this.rerun = true; // something changed mid-flush; go round again afterwards
      return this.flushing;
    }
    this.flushing = this.flushLoop().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async flushLoop() {
    const total = { targets: 0, delivered: 0, failed: 0 };
    do {
      this.rerun = false;
      const result = await this.flushOnce();
      total.targets = Math.max(total.targets, result.targets);
      total.delivered += result.delivered;
      total.failed += result.failed;
    } while (this.rerun);
    return total;
  }

  async flushOnce() {
    this.prune();
    const result = { targets: 0, delivered: 0, failed: 0 };
    if (this.records.size === 0) return result;

    const now = Date.now();
    const peers = (await getAllPeers())
      .filter((p) => p.bleId && now - Date.parse(p.timestamp) < PEER_FRESH_MS)
      .filter((p) => !this.isBackedOff(p.id))
      .sort((a, b) => (b.rssi || -100) - (a.rssi || -100));
    result.targets = peers.length;
    if (peers.length === 0) return result;

    // Most urgent first, then newest first.
    const records = [...this.records.values()].sort(
      (a, b) => priorityOf(b.envelope) - priorityOf(a.envelope) || b.addedAt - a.addedAt
    );

    let changed = false;
    for (const peer of peers) {
      for (const record of records) {
        const { envelope } = record;
        if (record.deliveredTo.includes(peer.id) || peer.id === envelope.from) continue;
        // Only the hop count changes when relaying; the signature covers everything else.
        const outgoing = record.origin === "relay" ? { ...envelope, hops: envelope.hops + 1 } : envelope;
        try {
          await BleTransport.send(peer, encodeEnvelope(outgoing));
          record.deliveredTo.push(peer.id);
          result.delivered += 1;
          changed = true;
        } catch (err) {
          console.log(`[SafeLink][Outbox] Send to ${peer.name} failed: ${err.message}`);
          this.backoff.set(peer.id, Date.now() + BACKOFF_MS);
          result.failed += 1;
          break; // this peer is unreachable right now; move on to the next one
        }
      }
    }
    if (changed) await this.persist();
    return result;
  }

  isBackedOff(peerId) {
    const until = this.backoff.get(peerId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.backoff.delete(peerId);
      return false;
    }
    return true;
  }

  /** Counts for the UI: messages we created that nobody has received yet, and the totals. */
  getStats() {
    const records = [...this.records.values()];
    const own = records.filter((r) => r.origin === "self" && !r.ephemeral);
    return {
      total: records.length,
      ownWaiting: own.filter((r) => r.deliveredTo.length === 0).length,
      ownDelivered: own.filter((r) => r.deliveredTo.length > 0).length,
      relaying: records.filter((r) => r.origin === "relay").length,
    };
  }

  stop() {
    clearInterval(this.intervalTimer);
    clearTimeout(this.debounceTimer);
    this.intervalTimer = null;
    this.debounceTimer = null;
  }
}

export default new Outbox();
