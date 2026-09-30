// server/models/LogModel.js
const fs = require("fs");
const path = require("path");
const DB_PATH = path.resolve("server_logs.json");

function load() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "[]");
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  async add(report) {
    const all = load();
    all.push({ ...report, receivedAt: new Date().toISOString() });
    save(all);
  },
};

