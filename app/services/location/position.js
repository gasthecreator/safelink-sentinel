// app/services/location/position.js
// A position attached to an alert: { latitude, longitude, accuracyM, fixedAt }.
//   accuracyM  horizontal accuracy in metres (null if the phone didn't say)
//   fixedAt    when the fix was taken (ms since epoch; null if unknown), which can be
//              long before the alert was sent if the phone had no fresh GPS fix
// Positions arrive from other people's phones, so everything is validated before use.

const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACCURACY_M = 1e6;

/** Accuracy worse than this means the phone only gave an approximate area. */
export const APPROXIMATE_ABOVE_M = 500;

/** Returns a clean position, or null if `p` is missing or not credible. */
export function sanitizePosition(p, now = Date.now()) {
  if (!p || typeof p !== "object") return null;
  const { latitude, longitude } = p;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const accuracyM =
    typeof p.accuracyM === "number" && Number.isFinite(p.accuracyM) && p.accuracyM >= 0 && p.accuracyM <= MAX_ACCURACY_M
      ? Math.round(p.accuracyM)
      : null;
  const fixedAt =
    typeof p.fixedAt === "number" && Number.isFinite(p.fixedAt) && p.fixedAt <= now + MAX_FUTURE_MS && p.fixedAt >= now - MAX_PAST_MS
      ? Math.round(p.fixedAt)
      : null;

  return {
    // ~1 cm precision is far beyond what GPS delivers
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    accuracyM,
    fixedAt,
  };
}

function ageLabel(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

function accuracyLabel(accuracyM) {
  if (accuracyM == null) return null;
  return accuracyM >= 1000 ? `±${(accuracyM / 1000).toFixed(1)} km` : `±${accuracyM} m`;
}

/** Human-readable pieces for showing a position. */
export function describePosition(position, now = Date.now()) {
  const p = sanitizePosition(position, now);
  if (!p) return null;
  const coords = `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
  const accuracy = accuracyLabel(p.accuracyM);
  const age = p.fixedAt != null ? ageLabel(Math.max(0, now - p.fixedAt)) : null;
  const approximate = p.accuracyM != null && p.accuracyM > APPROXIMATE_ABOVE_M;
  const details = [accuracy, age ? `fix ${age}` : null].filter(Boolean).join(", ");
  return {
    coords,
    accuracy,
    age,
    approximate,
    text: details ? `${coords} (${details})` : coords,
  };
}

/** A link that opens the position in the phone's own maps app (which may have offline maps). */
export function mapsUrl(position, label, platform) {
  const p = sanitizePosition(position);
  if (!p) return null;
  const name = encodeURIComponent(label || "SafeLink alert");
  if (platform === "ios") return `https://maps.apple.com/?ll=${p.latitude},${p.longitude}&q=${name}`;
  return `geo:${p.latitude},${p.longitude}?q=${p.latitude},${p.longitude}(${name})`;
}

/** One sentence telling the sender what happened with their location. */
export function describeLocationOutcome({ position, reason, stale, approximate } = {}, now = Date.now()) {
  if (position) {
    const d = describePosition(position, now);
    if (approximate) {
      return `Location attached, but only approximately (${d.accuracy}). Allow precise location in Settings so helpers can find you.`;
    }
    if (stale && d.age) return `Location attached from ${d.age} (no fresh GPS fix yet).`;
    return `Location attached${d.accuracy ? ` (${d.accuracy})` : ""}.`;
  }
  switch (reason) {
    case "denied":
      return "Sent without your location: location permission was declined.";
    case "unavailable":
      return "Sent without your location: no GPS fix. Try near a window or outdoors.";
    case "timeout":
      return "Sent without your location: no GPS fix in time.";
    default:
      return "Sent without your location.";
  }
}
