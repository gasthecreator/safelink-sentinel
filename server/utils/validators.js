// server/utils/validators.js
// One function per thing a client can send. Each returns { ok: true, value } with only known, cleaned
// fields, or { ok: false, error, message } to send back as a 400.

const v = require("./validate");

const bad = (error, message) => ({ ok: false, error, message });
const good = (value) => ({ ok: true, value });
const isObject = (b) => b && typeof b === "object" && !Array.isArray(b);

const RESCUE_TYPES = ["ACCEPT", "ARRIVED"];
const HELP_STATUSES = ["pending", "accepted", "fulfilled", "cancelled"];
const PRIORITIES = ["critical", "high", "normal", "low"];
// what the dashboard's check-in form offers (safe, caution, danger, evacuated), plus a few longer-standing names
const LOCATION_STATUSES = ["safe", "caution", "danger", "evacuated", "need_help", "help", "evacuating", "unknown", "needs_help", "injured"];

/** "Critical" / "critical" / " CRITICAL " -> "critical", or null. The dashboard sends "Critical". */
const priorityOf = (value) => (typeof value === "string" ? v.oneOf(value.trim().toLowerCase(), PRIORITIES) : null);
const capitalised = (p) => p.charAt(0).toUpperCase() + p.slice(1);

function helpRequest(body) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  const message = v.text(body.message, 2000, { multiline: true });
  if (!message) return bad("Missing required field: message", "Help request must include a message");
  const latitude = v.latitude(body.latitude);
  const longitude = v.longitude(body.longitude);
  if (latitude === null || longitude === null) return bad("Missing location", "Help request must include a valid latitude and longitude");
  const out = { message, latitude, longitude };
  const address = v.text(body.address, 300);
  if (address) out.address = address;
  out.status = v.oneOf(body.status, HELP_STATUSES) || "pending";
  // help requests are stored (and shown, and styled) as "Critical" / "High" / "Normal" / "Low"
  const priority = priorityOf(body.priority);
  if (priority) out.priority = capitalised(priority);
  // the dashboard marks a plain status post this way; kept so it can still tell them apart
  const kind = v.oneOf(body.type, ["status_update"]);
  if (kind) out.type = kind;
  const name = v.text(body.name, 100);
  if (name) out.name = name;
  const contact = v.text(body.contact || body.phone, 60);
  if (contact) out.contact = contact;
  return good(out);
}

function helpStatus(body) {
  const status = isObject(body) ? v.oneOf(body.status, HELP_STATUSES) : null;
  return status ? good(status) : bad("Invalid status", `Status must be one of: ${HELP_STATUSES.join(", ")}`);
}

function rescueEvent(body) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  const type = v.oneOf(body.type, RESCUE_TYPES);
  if (!type) return bad("Invalid type", `Rescue event type must be one of: ${RESCUE_TYPES.join(", ")}`);
  const alertId = v.id(body.alertId) || v.text(String(body.alertId ?? ""), 128);
  if (!alertId) return bad("Missing required field: alertId", "Rescue event must include 'alertId' field");
  const out = { type, alertId };
  const id = v.id(body.id);
  if (id) out.id = id;
  const reliefId = v.id(body.reliefId);
  if (reliefId) out.reliefId = reliefId;
  const helperId = v.id(body.helperId);
  if (helperId) out.helperId = helperId;
  const distanceKm = v.number(body.distanceKm, 0, 40000);
  if (distanceKm !== null) out.distanceKm = distanceKm;
  const etaMinutes = v.number(body.etaMinutes, 0, 100000);
  if (etaMinutes !== null) out.etaMinutes = etaMinutes;
  out.timestamp = v.recentIso(body.timestamp) || new Date().toISOString();
  return good(out);
}

function message(body) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  const content = v.text(body.content, 4000, { multiline: true });
  if (!content) return bad("Missing required field: content", "Message must include 'content' field");
  const senderId = v.id(body.senderId);
  if (!senderId) return bad("Missing required field: senderId", "Message must include a valid 'senderId' field");
  const out = { content, senderId };
  if (body.recipientId !== undefined && body.recipientId !== null && body.recipientId !== "") {
    const recipientId = v.id(body.recipientId);
    if (!recipientId) return bad("Invalid recipientId", "recipientId is not a valid id");
    out.recipientId = recipientId;
  }
  const id = v.id(body.id);
  if (id) out.id = id;
  out.type = v.oneOf(body.type, ["direct", "broadcast", "alert"]) || "direct";
  out.priority = priorityOf(body.priority) || "normal";
  out.timestamp = v.recentIso(body.timestamp) || new Date().toISOString();
  return good(out);
}

function peer(body) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  const id = v.id(body.id);
  if (!id) return bad("Missing required field: id", "Peer must include a valid 'id' field");
  const out = { id };
  const name = v.text(body.name || body.deviceName, 100);
  if (name) out.name = name;
  const rssi = v.number(body.rssi ?? body.signalStrength, -150, 20);
  if (rssi !== null) out.rssi = rssi;
  const distanceKm = v.number(body.distanceKm ?? body.distance, 0, 40000);
  if (distanceKm !== null) out.distanceKm = distanceKm;
  const lat = v.latitude(body.latitude ?? body.lat);
  const lon = v.longitude(body.longitude ?? body.lng);
  if (lat !== null && lon !== null) {
    out.latitude = lat;
    out.longitude = lon;
  }
  if (Array.isArray(body.capabilities)) {
    out.capabilities = body.capabilities.map((c) => v.text(c, 40)).filter(Boolean).slice(0, 10);
  }
  return good(out);
}

function locationUpdate(body, { now = Date.now() } = {}) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  const latitude = v.latitude(body.latitude);
  const longitude = v.longitude(body.longitude);
  if (latitude === null || longitude === null) return bad("Invalid location", "A valid latitude and longitude are required");
  return good({
    latitude,
    longitude,
    status: v.oneOf(body.status, LOCATION_STATUSES) || "safe",
    message: v.text(body.message, 500) || "",
    address: v.text(body.address, 300) || "Location detected",
    timestamp: v.recentIso(body.timestamp, now) || new Date(now).toISOString(),
    reporter: v.text(body.reporter, 80) || "Anonymous",
  });
}

function diagnostics(body) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  // a diagnostics report is stored as given, but only if it is small and flat enough to be one
  const json = JSON.stringify(body);
  if (json.length > 20000) return bad("Too large", "That report is too big.");
  return good(JSON.parse(json));
}

function sentinelSubscribe(body) {
  if (!isObject(body)) return bad("Bad request", "Send a JSON object.");
  const userId = v.id(body.user_id);
  const name = v.text(body.name, 100);
  if (!userId || !name) return bad("Missing required fields", "Both 'user_id' and 'name' are required");
  const out = { userId, name };
  if (body.lat !== undefined && body.lat !== null) {
    out.lat = v.latitude(body.lat);
    if (out.lat === null) return bad("Invalid lat", "lat must be a latitude");
  }
  if (body.lon !== undefined && body.lon !== null) {
    out.lon = v.longitude(body.lon);
    if (out.lon === null) return bad("Invalid lon", "lon must be a longitude");
  }
  return good(out);
}

module.exports = { helpRequest, helpStatus, rescueEvent, message, peer, locationUpdate, diagnostics, sentinelSubscribe, HELP_STATUSES, RESCUE_TYPES };
