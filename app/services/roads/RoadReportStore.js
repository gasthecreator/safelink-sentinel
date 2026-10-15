// app/services/roads/RoadReportStore.js
// Remembers road reports (ours and ones received), publishes new ones over the mesh, and
// answers "which closures are in force right now?".
//
// Limits protect against flooding: at most MAX_PER_SENDER reports are kept from any one
// phone and MAX_TOTAL overall (oldest go first), so a hostile or buggy phone cannot push
// everyone else's reports out of memory.

import AsyncStorage from "@react-native-async-storage/async-storage";
import GeoBroadcast from "../mesh/GeoBroadcast.js";
import IdentityManager from "../crypto/IdentityManager.js";
import { sanitizeReport, sanitizeStoredReport, effectiveClosures, reportText, KEEP_MS, MAX_TOTAL, MAX_PER_SENDER } from "./reports.js";

const STORAGE_KEY = "@safelink_road_reports";

class RoadReportStore {
  constructor() {
    this.reports = [];
    this.loaded = null;
    this.listeners = [];
  }

  init() {
    if (!this.loaded) this.loaded = this.load();
    return this.loaded;
  }

  async load() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      const seen = new Set();
      this.reports = (Array.isArray(saved) ? saved : [])
        .map((r) => sanitizeStoredReport(r))
        .filter((r) => r && !seen.has(r.id) && seen.add(r.id));
      this.prune();
    } catch (err) {
      console.log("[SafeLink][Roads] Could not read saved reports:", err.message);
      this.reports = [];
    }
  }

  prune(now = Date.now()) {
    this.reports = this.reports.filter((r) => now - r.reportedAt < KEEP_MS);
    // per-sender cap: keep each phone's newest
    const bySender = new Map();
    for (const r of [...this.reports].sort((a, b) => b.reportedAt - a.reportedAt)) {
      bySender.set(r.senderId, (bySender.get(r.senderId) || 0) + 1);
      if (bySender.get(r.senderId) > MAX_PER_SENDER) r.drop = true;
    }
    this.reports = this.reports.filter((r) => !r.drop);
    if (this.reports.length > MAX_TOTAL) {
      this.reports.sort((a, b) => b.reportedAt - a.reportedAt);
      this.reports.length = MAX_TOTAL;
    }
  }

  async persist() {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.reports));
    } catch (err) {
      console.log("[SafeLink][Roads] Could not save reports:", err.message);
    }
  }

  /** Add an already-validated report. Returns true if it was new. */
  async add(report) {
    await this.init();
    if (this.reports.some((r) => r.id === report.id)) return false;
    this.reports.push(report);
    this.prune();
    await this.persist();
    this.listeners.forEach((cb) => cb());
    return this.reports.some((r) => r.id === report.id); // false if the caps dropped it straight away
  }

  /** A verified message from another phone: keep it if it is a credible road report. */
  async handleIncoming(msg) {
    const meta = (msg && msg.meta) || {};
    if (meta.type !== "road_report" || msg.type !== "broadcast") return false;
    const report = sanitizeReport({
      id: msg.id,
      kind: meta.kind,
      position: meta.position,
      note: meta.note,
      senderId: msg.from,
      reportedAt: Date.parse(msg.sentAt),
    });
    if (!report) {
      console.log("[SafeLink][Roads] Ignored an invalid road report");
      return false;
    }
    return this.add(report);
  }

  /**
   * Say a road is blocked / passable / hazardous at `position`. Goes out over the mesh to
   * everyone in range now and later; also kept here so our own routes respect it.
   * Returns the broadcast summary.
   */
  async publish({ kind, position, note = null }) {
    await this.init();
    const clean = sanitizeReport({
      id: "pending",
      kind,
      position,
      note,
      senderId: "me",
      reportedAt: Date.now(),
    });
    if (!clean) throw new Error("That report isn't valid: it needs a kind and a position.");
    const myId = await IdentityManager.getDeviceId();
    const summary = await GeoBroadcast.broadcast(myId, reportText(clean.kind, clean.note), {
      priority: "high",
      position,
      extraMeta: { type: "road_report", kind: clean.kind, ...(clean.note ? { note: clean.note } : {}) },
    });
    // the broadcast's own id is the report id, so a phone that hears it twice keeps one
    await this.add({ ...clean, id: summary.id, senderId: myId });
    return summary;
  }

  /** Reports still remembered (newest first). */
  list(now = Date.now()) {
    return this.reports.filter((r) => now - r.reportedAt < KEEP_MS).sort((a, b) => b.reportedAt - a.reportedAt);
  }

  /** Closures and hazards in force right now. */
  closures(now = Date.now()) {
    return effectiveClosures(this.reports, now);
  }

  subscribe(cb) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== cb);
    };
  }

  async clear() {
    this.reports = [];
    await this.persist();
    this.listeners.forEach((cb) => cb());
  }
}

export default new RoadReportStore();
