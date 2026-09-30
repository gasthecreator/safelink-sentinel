// server/services/DisasterSentinelService.js
//
// Ported from gasthecreator/disaster-sentinel (main.py, FastAPI/Python).
// Pulls live disaster events from GDACS, tracks subscribed users, and
// classifies each user's proximity/risk to active events.
const axios = require("axios");
const DisasterSentinelModel = require("../models/DisasterSentinelModel");

const GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events";

// Risk radius (miles) per disaster type, mirrors the original Python RISK_RADIUS table.
const RISK_RADIUS = {
  Hurricane: 100,
  Flood: 50,
  Wildfire: 75,
  Tornado: 25,
  Earthquake: 60,
};

const DEFAULT_RISK_RADIUS = 50;

// Center of the continental US — same fallback the Python service used when
// a user provides no coordinates and IP geolocation fails.
const DEFAULT_LAT = 39.8283;
const DEFAULT_LON = -98.5795;

function mapGdacsType(gdacsTitle) {
  const title = (gdacsTitle || "").toLowerCase();
  if (title.includes("fire") || title.includes("wildfire")) return "Wildfire";
  if (
    title.includes("storm") ||
    title.includes("cyclone") ||
    title.includes("hurricane") ||
    title.includes("typhoon")
  )
    return "Hurricane";
  if (title.includes("flood")) return "Flood";
  if (title.includes("volcano")) return "Volcano";
  if (title.includes("earthquake")) return "Earthquake";
  return gdacsTitle;
}

function parseGdacsTimestamp(ev) {
  const tsFields = ["fromdate", "eventdate", "publisheddate", "date", "fromDate", "eventDate"];
  for (const field of tsFields) {
    const value = ev[field];
    if (!value) continue;
    try {
      if (typeof value === "string") {
        const iso = new Date(value).toISOString();
        if (!Number.isNaN(new Date(value).getTime())) return iso;
      } else if (typeof value === "number") {
        // GDACS sometimes gives seconds, sometimes ms epoch — same heuristic as the Python port.
        const ms = value > 1e10 ? value : value * 1000;
        return new Date(ms).toISOString();
      }
    } catch {
      continue;
    }
  }
  return new Date().toISOString();
}

function parseGdacsEvent(ev) {
  const lat = ev.latitude ?? ev.lat;
  const lon = ev.longitude ?? ev.lon ?? ev.lng;
  if (lat == null || lon == null) return null;

  const latFloat = parseFloat(lat);
  const lonFloat = parseFloat(lon);
  if (Number.isNaN(latFloat) || Number.isNaN(lonFloat)) return null;

  const disasterType = ev.eventtype || ev.title || ev.eventType || "Disaster";
  const mappedType = mapGdacsType(disasterType);

  return {
    id: String(ev.eventid ?? ev.id ?? ev.eventId ?? ""),
    type: mappedType,
    coordinates: [latFloat, lonFloat],
    severity: ev.alertlevel || ev.alertLevel || "unknown",
    timestamp: parseGdacsTimestamp(ev),
  };
}

async function fetchGdacsEvents() {
  try {
    const resp = await axios.get(GDACS_URL, { timeout: 10000 });
    let data = resp.data;
    if (data && !Array.isArray(data)) data = data.results || [];

    const events = [];
    for (const ev of data) {
      const parsed = parseGdacsEvent(ev);
      if (parsed) events.push(parsed);
    }
    return events;
  } catch (err) {
    console.error("[SafeLink][DisasterSentinel] GDACS fetch failed:", err.message);
    return [];
  }
}

async function fetchRecentGdacsEvents(since) {
  try {
    const resp = await axios.get(GDACS_URL, { timeout: 10000 });
    let data = resp.data;
    if (data && !Array.isArray(data)) data = data.results || [];

    const events = [];
    for (const ev of data) {
      const parsed = parseGdacsEvent(ev);
      if (!parsed) continue;
      if (new Date(parsed.timestamp) >= since) events.push(parsed);
    }
    return events;
  } catch (err) {
    console.error("[SafeLink][DisasterSentinel] GDACS resync fetch failed:", err.message);
    return [];
  }
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

// Haversine distance in miles. The original Python service used geopy's
// geodesic (ellipsoidal) distance; Haversine assumes a perfect sphere, which
// differs by well under 1% at these ranges — negligible against 25-100mi
// risk-radius thresholds.
function calculateDistanceMiles(userCoords, disasterCoords) {
  const R_MILES = 3958.8;
  const [lat1, lon1] = userCoords;
  const [lat2, lon2] = disasterCoords;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_MILES * c;
}

function categorizeRisk(userDist, disasterType) {
  const baseRadius = RISK_RADIUS[disasterType] || DEFAULT_RISK_RADIUS;
  if (userDist <= 0.5 * baseRadius) return "High";
  if (userDist <= baseRadius) return "Moderate";
  if (userDist <= 1.5 * baseRadius) return "Low";
  return null;
}

function classifyProximity(riskLevel) {
  if (riskLevel === "High") return "Immediate Danger";
  if (riskLevel === "Moderate") return "Caution Zone";
  if (riskLevel === "Low") return "Informational";
  return "Unknown";
}

// Returns [alertLevel, timeDescription], mirroring classify_alert_level in main.py.
function classifyAlertLevel(eventTimestamp) {
  try {
    const eventDt = new Date(eventTimestamp);
    if (Number.isNaN(eventDt.getTime())) return ["Emergency", "Unknown time"];

    const hoursUntil = (eventDt.getTime() - Date.now()) / 3_600_000;

    if (hoursUntil > 72) return ["Reminder", `${Math.floor(hoursUntil / 24)} days away`];
    if (hoursUntil > 24) return ["Warning", `${Math.floor(hoursUntil / 24)} days away`];
    if (hoursUntil < 0) return ["Emergency", "Past event"];
    return ["Emergency", `Within ${Math.floor(hoursUntil)}h`];
  } catch {
    return ["Emergency", "Unknown time"];
  }
}

async function shouldSendAlert(userId, minHours = 6) {
  const lastAlertMap = await DisasterSentinelModel.getLastAlertMap();
  const lastStr = lastAlertMap[userId];
  const now = new Date();

  if (!lastStr) {
    await DisasterSentinelModel.setLastAlert(userId, now.toISOString());
    return true;
  }

  const last = new Date(lastStr);
  if (Number.isNaN(last.getTime()) || now - last > minHours * 3_600_000) {
    await DisasterSentinelModel.setLastAlert(userId, now.toISOString());
    return true;
  }

  return false;
}

async function sendAlert(user, event, riskLevel) {
  const [alertLevel, timeDesc] = classifyAlertLevel(event.timestamp);
  const proximityLabel = classifyProximity(riskLevel);

  const payload = {
    user_id: user.user_id,
    user_name: user.name,
    disaster_type: event.type,
    risk_level: riskLevel,
    alert_level: alertLevel,
    proximity_level: proximityLabel,
    coords: event.coordinates,
    severity: event.severity || "unknown",
    event_id: event.id || "unknown",
    timestamp: new Date().toISOString(),
  };

  await DisasterSentinelModel.addAlert(payload);

  console.log(
    `[SafeLink][DisasterSentinel] [${alertLevel}][${proximityLabel}] alert -> ${user.name} | ${event.type} | ${riskLevel} risk | (${timeDesc})`
  );

  return payload;
}

// IP geolocation fallback for users who don't submit coordinates on subscribe.
async function getUserLocationFromIp(ip) {
  if (!ip) return null;
  if (ip === "127.0.0.1" || ip === "localhost" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10."))
    return null;

  try {
    const resp = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 5000 });
    const data = resp.data;
    const lat = data.latitude;
    const lon = data.longitude;
    if (lat != null && lon != null) {
      console.log(
        `[SafeLink][DisasterSentinel] Detected location for IP ${ip}: ${data.city || "Unknown"}, ${data.region || "Unknown"}, ${data.country_name || "Unknown"} (${lat}, ${lon})`
      );
      return { lat: parseFloat(lat), lon: parseFloat(lon) };
    }
  } catch (err) {
    console.error(`[SafeLink][DisasterSentinel] IP geolocation failed for ${ip}:`, err.message);
  }

  return null;
}

// Fetches fresh events, refreshes the cache, and (if the feed had been down)
// resyncs the last 24h of events once connectivity returns.
async function safeUpdateEvents() {
  const cache = await DisasterSentinelModel.getCache();

  try {
    let events = await fetchGdacsEvents();

    if ((cache.consecutive_failures || 0) > 1) {
      console.log("[SafeLink][DisasterSentinel] Network restored - resyncing last 24 hours...");
      const since = new Date(Date.now() - 24 * 3_600_000);
      const recentEvents = await fetchRecentGdacsEvents(since);

      const existingIds = new Set((cache.events || []).map((e) => e.id));
      for (const event of recentEvents) {
        if (!existingIds.has(event.id)) events.push(event);
      }
      console.log(`[SafeLink][DisasterSentinel] Resynced ${recentEvents.length} events from last 24 hours`);
    }

    cache.events = events;
    cache.last_update = new Date().toISOString();
    cache.consecutive_failures = 0;
    await DisasterSentinelModel.saveCache(cache);
    console.log(`[SafeLink][DisasterSentinel] events updated: ${events.length}`);
  } catch (err) {
    cache.consecutive_failures = (cache.consecutive_failures || 0) + 1;
    if (cache.consecutive_failures > 1) {
      console.log(
        `[SafeLink][DisasterSentinel] Network outage - switching to offline mode (failure #${cache.consecutive_failures})`
      );
    } else {
      console.log(`[SafeLink][DisasterSentinel] error updating events - using cached events: ${err.message}`);
    }
    await DisasterSentinelModel.saveCache(cache);
  }
}

// Cross-references cached disaster events against every subscribed user and
// fires (cooldown-gated) alerts for anyone within risk range.
async function processEventsForUsers() {
  const cache = await DisasterSentinelModel.getCache();
  if (!cache.events || cache.events.length === 0) return;

  const users = await DisasterSentinelModel.getUsers();

  for (const event of cache.events) {
    if (!Array.isArray(event.coordinates) || event.coordinates.length !== 2) continue;

    for (const [userId, user] of Object.entries(users)) {
      try {
        if (user.lat == null || user.lon == null) continue;

        const userCoords = [parseFloat(user.lat), parseFloat(user.lon)];
        const eventCoords = [parseFloat(event.coordinates[0]), parseFloat(event.coordinates[1])];
        if (userCoords.some(Number.isNaN) || eventCoords.some(Number.isNaN)) continue;

        const dist = calculateDistanceMiles(userCoords, eventCoords);
        const risk = categorizeRisk(dist, event.type);

        if (risk && (await shouldSendAlert(userId))) {
          await sendAlert(user, event, risk);
        }
      } catch (err) {
        console.error(
          `[SafeLink][DisasterSentinel] Error processing event ${event.id || "unknown"} for user ${userId}:`,
          err.message
        );
      }
    }
  }
}

module.exports = {
  RISK_RADIUS,
  DEFAULT_LAT,
  DEFAULT_LON,
  mapGdacsType,
  fetchGdacsEvents,
  fetchRecentGdacsEvents,
  calculateDistanceMiles,
  categorizeRisk,
  classifyProximity,
  classifyAlertLevel,
  shouldSendAlert,
  sendAlert,
  getUserLocationFromIp,
  safeUpdateEvents,
  processEventsForUsers,
};
