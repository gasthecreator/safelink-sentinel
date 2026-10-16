// app/services/storage/ReliefRequestStore.js
// Persists relief/donation requests created via AlertManager

import AsyncStorage from "@react-native-async-storage/async-storage";

const RELIEF_STORAGE_KEY = "@safelink_relief_requests";
// Requests from other phones are limited, so a flood cannot fill the phone's storage or bury real ones.
export const MAX_REMOTE_REQUESTS = 100;
export const MAX_REMOTE_PER_SENDER = 5;
const REMOTE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

class ReliefRequestStore {
  constructor() {
    this.requests = [];
    this.initialized = false;
    this.loading = null;
  }

  // One shared load: two requests arriving together at startup must not each load (and the second
  // load overwrite what the first one already added).
  init() {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  async load() {
    try {
      const raw = await AsyncStorage.getItem(RELIEF_STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      this.requests = [...(Array.isArray(saved) ? saved : []), ...this.requests];
      console.log(
        `[SafeLink][ReliefRequestStore] Loaded ${this.requests.length} relief requests`
      );
    } catch (err) {
      console.error("[SafeLink][ReliefRequestStore] ❌ Error loading requests:", err);
    }
    this.initialized = true;
  }

  async _save() {
    try {
      await AsyncStorage.setItem(RELIEF_STORAGE_KEY, JSON.stringify(this.requests));
    } catch (err) {
      console.error("[SafeLink][ReliefRequestStore] ❌ Error saving requests:", err);
    }
  }

  async createRequest(request) {
    await this.init();
    this.requests.push(request);
    await this._save();
    console.log(`[SafeLink][ReliefRequestStore] 📝 Created request ${request.id}`);
    return request;
  }

  /**
   * Keep a request received from another phone. Each sender may hold a few, the total is capped, and
   * old ones are forgotten; the oldest go first. Requests this phone made itself are never touched.
   */
  async addRemote(request) {
    await this.init();
    this.requests.push(request);
    const now = Date.now();
    const remote = this.requests
      .filter((r) => r.remote)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const drop = new Set();
    const perSender = new Map();
    remote.forEach((r, i) => {
      const n = (perSender.get(r.requesterId) || 0) + 1;
      perSender.set(r.requesterId, n);
      const tooOld = Number.isFinite(Date.parse(r.createdAt)) && now - Date.parse(r.createdAt) > REMOTE_KEEP_MS;
      if (n > MAX_REMOTE_PER_SENDER || i >= MAX_REMOTE_REQUESTS || tooOld) drop.add(r);
    });
    this.requests = this.requests.filter((r) => !drop.has(r));
    await this._save();
    return this.requests.includes(request);
  }

  async getAllRequests() {
    await this.init();
    return this.requests;
  }

  async getOpenRequests() {
    await this.init();
    return this.requests.filter(
      (r) => r.status === "open" || r.status === "partial"
    );
  }

  async getRequest(id) {
    await this.init();
    return this.requests.find((r) => r.id === id) || null;
  }

  async updateStatus(id, status) {
    await this.init();
    const request = this.requests.find((r) => r.id === id);
    if (!request) {
      console.log(`[SafeLink][ReliefRequestStore] ⚠️ No request found for ${id}`);
      return null;
    }
    request.status = status;
    request.updatedAt = new Date().toISOString();
    await this._save();
    console.log(`[SafeLink][ReliefRequestStore] 🔄 ${id} → ${status}`);
    return request;
  }

  async clearAll() {
    this.requests = [];
    await this._save();
    console.log("[SafeLink][ReliefRequestStore] 🧹 Cleared all relief requests");
  }
}

export default new ReliefRequestStore();
