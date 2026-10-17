// server/models/LogModel.js
const fs = require("fs");
const path = require("path");
const { dataFile } = require("../utils/dataPath");
const { writeJsonAtomic } = require("../utils/atomicFile");
const DB_PATH = dataFile("server_logs.json", process.cwd());
const MAX_RECORDS = 1000;

function load() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "[]");
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function save(data) {
  writeJsonAtomic(DB_PATH, data.length > MAX_RECORDS ? data.slice(-MAX_RECORDS) : data);
}

module.exports = {
  async add(report) {
    const all = load();
    all.push({ ...report, receivedAt: new Date().toISOString() });
    save(all);
  },
};

