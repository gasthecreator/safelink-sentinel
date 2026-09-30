// app/services/mesh/SyncManager.js

import AsyncStorage from "@react-native-async-storage/async-storage";

const SYNC_QUEUE_KEY = "@safelink_sync_queue";
const SYNC_STATUS_KEY = "@safelink_sync_status";

/**
 * SyncManager
 * Handles synchronization of offline messages and data
 * when network connectivity is restored
 */
class SyncManager {
  constructor() {
    this.syncQueue = [];
    this.isSyncing = false;
    this.listeners = [];
  }

  // Initialize and load pending items
  async initialize() {
    try {
      const queue = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
      this.syncQueue = queue ? JSON.parse(queue) : [];
      console.log(`[SyncManager] Initialized with ${this.syncQueue.length} pending items`);
    } catch (error) {
      console.error("[SyncManager] Initialization error:", error);
    }
  }

  // Add item to sync queue
  async addToQueue(item) {
    try {
      const syncItem = {
        id: item.id || Date.now().toString(),
        data: item,
        timestamp: new Date().toISOString(),
        retries: 0,
        status: "pending"
      };

      this.syncQueue.push(syncItem);
      await this.saveQueue();
      this.notifyListeners();

      console.log(`[SyncManager] Added to queue: ${syncItem.id}`);
      return syncItem;
    } catch (error) {
      console.error("[SyncManager] Error adding to queue:", error);
      throw error;
    }
  }

  // Save queue to storage
  async saveQueue() {
    try {
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.syncQueue));
    } catch (error) {
      console.error("[SyncManager] Error saving queue:", error);
    }
  }

  // Start synchronization process
  async startSync(onlineCheck = null) {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;
    console.log(`[SyncManager] Starting sync of ${this.syncQueue.length} items...`);

    const results = {
      success: 0,
      failed: 0,
      total: this.syncQueue.length
    };

    for (let i = this.syncQueue.length - 1; i >= 0; i--) {
      const item = this.syncQueue[i];

      try {
        // Check online status if checker provided
        if (onlineCheck && !(await onlineCheck())) {
          console.log("[SyncManager] Offline - stopping sync");
          break;
        }

        // Attempt to sync item
        const success = await this.syncItem(item);

        if (success) {
          this.syncQueue.splice(i, 1);
          results.success++;
          console.log(`[SyncManager] ✅ Synced: ${item.id}`);
        } else {
          item.retries++;
          if (item.retries >= 3) {
            item.status = "failed";
            results.failed++;
            console.log(`[SyncManager] ❌ Failed after 3 retries: ${item.id}`);
          }
        }
      } catch (error) {
        console.error(`[SyncManager] Error syncing item ${item.id}:`, error);
        item.retries++;
        if (item.retries >= 3) {
          item.status = "failed";
          results.failed++;
        }
      }
    }

    await this.saveQueue();
    this.isSyncing = false;
    this.notifyListeners();

    console.log(`[SyncManager] Sync complete: ${results.success} success, ${results.failed} failed`);
    return results;
  }

  // Sync individual item (override this method for actual sync logic)
  async syncItem(item) {
    // Simulate sync delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Default implementation - override in your app
    console.log(`[SyncManager] Syncing item: ${item.id}`);
    return true; // Return true if sync successful
  }

  // Get sync status
  getSyncStatus() {
    return {
      isSyncing: this.isSyncing,
      queueLength: this.syncQueue.length,
      pending: this.syncQueue.filter(i => i.status === "pending").length,
      failed: this.syncQueue.filter(i => i.status === "failed").length
    };
  }

  // Get all queued items
  getQueue() {
    return this.syncQueue;
  }

  // Clear failed items
  async clearFailed() {
    this.syncQueue = this.syncQueue.filter(i => i.status !== "failed");
    await this.saveQueue();
    this.notifyListeners();
    console.log("[SyncManager] Cleared failed items");
  }

  // Clear entire queue
  async clearQueue() {
    this.syncQueue = [];
    await this.saveQueue();
    this.notifyListeners();
    console.log("[SyncManager] Queue cleared");
  }

  // Add sync listener
  onSyncUpdate(callback) {
    if (typeof callback === "function") {
      this.listeners.push(callback);
    }
  }

  // Notify all listeners
  notifyListeners() {
    const status = this.getSyncStatus();
    this.listeners.forEach(callback => callback(status));
  }

  // Remove item from queue by ID
  async removeFromQueue(itemId) {
    this.syncQueue = this.syncQueue.filter(i => i.id !== itemId);
    await this.saveQueue();
    this.notifyListeners();
    console.log(`[SyncManager] Removed item: ${itemId}`);
  }
}

export default new SyncManager();

