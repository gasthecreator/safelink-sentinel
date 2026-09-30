// server/models/DisasterSentinelModel.js
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const USERS_FILE = path.join(DATA_DIR, "sentinelUsers.json");
const ALERTS_FILE = path.join(DATA_DIR, "sentinelAlerts.json");
const CACHE_FILE = path.join(DATA_DIR, "sentinelCache.json");
const LAST_ALERT_FILE = path.join(DATA_DIR, "sentinelLastAlert.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`[SafeLink][DisasterSentinelModel] Failed to read ${filePath}:`, err.message);
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  async getUsers() {
    return loadJson(USERS_FILE, {});
  },

  async getUser(userId) {
    const users = loadJson(USERS_FILE, {});
    return users[userId] || null;
  },

  async saveUser(userId, user) {
    const users = loadJson(USERS_FILE, {});
    users[userId] = user;
    saveJson(USERS_FILE, users);
    return user;
  },

  async getAlerts() {
    return loadJson(ALERTS_FILE, []);
  },

  async addAlert(alert) {
    const alerts = loadJson(ALERTS_FILE, []);
    alerts.push(alert);
    saveJson(ALERTS_FILE, alerts);
    return alert;
  },

  async getCache() {
    return loadJson(CACHE_FILE, { last_update: null, events: [], consecutive_failures: 0 });
  },

  async saveCache(cache) {
    saveJson(CACHE_FILE, cache);
    return cache;
  },

  async getLastAlertMap() {
    return loadJson(LAST_ALERT_FILE, {});
  },

  async setLastAlert(userId, isoTimestamp) {
    const map = loadJson(LAST_ALERT_FILE, {});
    map[userId] = isoTimestamp;
    saveJson(LAST_ALERT_FILE, map);
  },
};
