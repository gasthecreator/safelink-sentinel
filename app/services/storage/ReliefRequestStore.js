// app/services/storage/ReliefRequestStore.js
// Persists relief/donation requests created via AlertManager

import AsyncStorage from "@react-native-async-storage/async-storage";

const RELIEF_STORAGE_KEY = "@safelink_relief_requests";

class ReliefRequestStore {
  constructor() {
    this.requests = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const raw = await AsyncStorage.getItem(RELIEF_STORAGE_KEY);
      this.requests = raw ? JSON.parse(raw) : [];
      console.log(
        `[SafeLink][ReliefRequestStore] Loaded ${this.requests.length} relief requests`
      );
    } catch (err) {
      console.error("[SafeLink][ReliefRequestStore] ❌ Error loading requests:", err);
      this.requests = [];
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
