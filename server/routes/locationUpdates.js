// server/routes/locationUpdates.js
// "I am safe / I need help" check-ins with a position, shown on the dashboard map.

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { dataFile } = require("../utils/dataPath");
const { writeJsonAtomic } = require("../utils/atomicFile");
const validators = require("../utils/validators");
const v = require("../utils/validate");

const DATA_FILE = dataFile("locationUpdates.json", path.join(__dirname, "../data"));
const MAX_RECORDS = 5000;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000; // a check-in older than two weeks is not news

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Reading, adding and saving happen with no pause between them (nothing here waits), so two requests
// cannot both read the old list and the second overwrite the first.
function add(update) {
  const now = Date.now();
  const all = load().filter((u) => now - Date.parse(u.timestamp) < MAX_AGE_MS);
  all.push(update);
  writeJsonAtomic(DATA_FILE, all.length > MAX_RECORDS ? all.slice(-MAX_RECORDS) : all);
}

router.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const updates = load().filter((u) => status === "all" || u.status === status);
  updates.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(updates.slice(0, v.limit(req.query.limit, 500, 1000)));
});

router.post("/", (req, res) => {
  const checked = validators.locationUpdate(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error, message: checked.message });
  const update = { id: `update-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, ...checked.value };
  add(update);
  res.status(201).json(update);
});

router.get("/nearby", (req, res) => {
  const lat = v.latitude(req.query.lat);
  const lon = v.longitude(req.query.lon);
  if (lat === null || lon === null) return res.status(400).json({ error: "Latitude and longitude required" });
  const radius = v.number(req.query.radius === undefined ? 5 : req.query.radius, 0.1, 500) ?? 5; // km
  const nearby = load().filter((u) => Number.isFinite(u.latitude) && Number.isFinite(u.longitude) && calculateDistance(lat, lon, u.latitude, u.longitude) <= radius);
  res.json(nearby.slice(0, 1000));
});

// Haversine distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

module.exports = router;
