// app/services/storage/MessageCache.js
// Persists in-flight/delivered messages so the queue survives app restarts

import AsyncStorage from "@react-native-async-storage/async-storage";

const MESSAGE_CACHE_KEY = "@safelink_message_cache";

class MessageCache {
  async _getAll() {
    try {
      const raw = await AsyncStorage.getItem(MESSAGE_CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("[SafeLink][MessageCache] ❌ Error reading cache:", err);
      return [];
    }
  }

  async _saveAll(messages) {
    try {
      await AsyncStorage.setItem(MESSAGE_CACHE_KEY, JSON.stringify(messages));
    } catch (err) {
      console.error("[SafeLink][MessageCache] ❌ Error saving cache:", err);
    }
  }

  async storeMessage(message) {
    const messages = await this._getAll();
    const existingIndex = messages.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      messages[existingIndex] = message;
    } else {
      messages.push(message);
    }
    await this._saveAll(messages);
  }

  async updateMessage(message) {
    return this.storeMessage(message);
  }

  async getMessage(id) {
    const messages = await this._getAll();
    return messages.find((m) => m.id === id) || null;
  }

  async getAllMessages() {
    return this._getAll();
  }

  async removeMessage(id) {
    const messages = await this._getAll();
    const filtered = messages.filter((m) => m.id !== id);
    await this._saveAll(filtered);
  }

  async clear() {
    try {
      await AsyncStorage.removeItem(MESSAGE_CACHE_KEY);
      console.log("[SafeLink][MessageCache] 🧹 Cache cleared");
    } catch (err) {
      console.error("[SafeLink][MessageCache] ❌ Error clearing cache:", err);
    }
  }
}

export default new MessageCache();
