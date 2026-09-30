// server/models/RescueModel.js
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../../data/rescueLogs.json");
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ rescues: [] }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  // Ensure rescues array exists
  if (!data.rescues) {
    data.rescues = [];
    save(data);
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  async add(rescue) {
    const data = load();
    // Ensure rescue has timestamp
    if (!rescue.timestamp) {
      rescue.timestamp = new Date().toISOString();
    }
    // Ensure rescue has id if not provided
    if (!rescue.id) {
      rescue.id = `rescue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    data.rescues.push(rescue);
    save(data);
    console.log("[SafeLink][RescueModel] 📄 Rescue event added:", rescue.id);
    return rescue;
  },

  async all() {
    const data = load();
    return data.rescues;
  },

  async getById(id) {
    const data = load();
    return data.rescues.find((r) => r.id === id) || null;
  },

  async getByAlertId(alertId) {
    const data = load();
    return data.rescues.filter((r) => r.alertId === alertId);
  },

  async getByType(type) {
    const data = load();
    return data.rescues.filter((r) => r.type === type);
  },

  async stats() {
    const data = load();
    const rescues = data.rescues;

    const total = rescues.length;
    const accepted = rescues.filter((r) => r.type === "ACCEPT").length;
    const arrived = rescues.filter((r) => r.type === "ARRIVED").length;

    // Calculate average distance
    const rescuesWithDistance = rescues.filter((r) => r.distanceKm != null);
    const avgDistance =
      rescuesWithDistance.length > 0
        ? rescuesWithDistance.reduce((sum, r) => sum + r.distanceKm, 0) /
          rescuesWithDistance.length
        : 0;

    // Calculate average ETA
    const rescuesWithETA = rescues.filter((r) => r.etaMinutes != null);
    const avgETA =
      rescuesWithETA.length > 0
        ? rescuesWithETA.reduce((sum, r) => sum + r.etaMinutes, 0) /
          rescuesWithETA.length
        : 0;

    // Get latest rescues (last 10)
    const latest = rescues
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    return {
      total,
      accepted,
      arrived,
      avgDistance: avgDistance.toFixed(2),
      avgETA: Math.round(avgETA),
      latest,
    };
  },

  async getRecent(limit = 20) {
    const data = load();
    return data.rescues
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  },

  async clear() {
    save({ rescues: [] });
    console.log("[SafeLink][RescueModel] 🧹 Cleared all rescue logs");
    return { success: true };
  },
};

