// app/services/location/position.js
// A position attached to an alert: { latitude, longitude, accuracyM, fixedAt, source, label }.
//   accuracyM  horizontal accuracy in metres (null if the phone didn't say)
//   fixedAt    when the fix was taken (ms since epoch; null if unknown), which can be
//              long before the alert was sent if the phone had no fresh GPS fix
//   source     where it came from: "gps" (the phone measured it), "place" (a saved
//              place the sender chose) or "manual" (typed in by hand); null if unknown
//   label      the place's name, for source "place"
// Positions arrive from other people's phones, so everything is validated before use.
import { formatAccuracy } from "../units/units.js";
import { t } from "../i18n/i18n.js";


const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACCURACY_M = 1e6;
const SOURCES = ["gps", "place", "manual"];
export const MAX_LABEL = 60;
export const MAX_NOTE = 200;

/**
 * Plain text from a person or from the network: strings only, control characters
 * turned into spaces, invisible direction/zero-width characters removed (they can make
 * text display backwards or hide content), whitespace tidied, length capped.
 * Returns null if nothing is left.
 */
export function sanitizeText(value, max = MAX_NOTE) {
  if (typeof value !== "string") return null;
  const clean = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Like sanitizeText but keeps line breaks (at most 20 lines): for message bodies from other phones.
 * Control characters and invisible direction-changing characters are removed, length capped.
 */
export function sanitizeMultiline(value, max = 2000) {
  if (typeof value !== "string") return null;
  const lines = value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim());
  const clean = lines.slice(0, 20).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean ? clean.slice(0, max) : null;
}

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

  const source = SOURCES.includes(p.source) ? p.source : null;
  return {
    // ~1 cm precision is far beyond what GPS delivers
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    accuracyM,
    fixedAt,
    source,
    label: source === "place" ? sanitizeText(p.label, MAX_LABEL) : null,
  };
}

function ageLabel(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{minutes} min ago", { minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t("{hours} h ago", { hours }) : t("{days} d ago", { days: Math.floor(hours / 24) });
}

function accuracyLabel(accuracyM) {
  if (accuracyM == null) return null;
  return formatAccuracy(accuracyM);
}

/** Human-readable pieces for showing a position. */
export function describePosition(position, now = Date.now()) {
  const p = sanitizePosition(position, now);
  if (!p) return null;
  const coords = `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
  const accuracy = accuracyLabel(p.accuracyM);
  const age = p.fixedAt != null ? ageLabel(Math.max(0, now - p.fixedAt)) : null;
  const approximate = p.accuracyM != null && p.accuracyM > APPROXIMATE_ABOVE_M;
  const details = [accuracy, age ? t("fix {age}", { age }) : null].filter(Boolean).join(", ");
  const provenance =
    p.source === "place"
      ? p.label
        ? t("From the saved place \"{label}\"", { label: p.label })
        : t("From a saved place")
      : p.source === "manual"
      ? t("Entered by hand, not measured")
      : null;
  return {
    coords,
    accuracy,
    age,
    approximate,
    provenance,
    source: p.source,
    text: details ? `${coords} (${details})` : coords,
  };
}

/** A link that opens the position in the phone's own maps app (which may have offline maps). */
export function mapsUrl(position, label, platform) {
  const p = sanitizePosition(position);
  if (!p) return null;
  const name = encodeURIComponent(label || t("SafeLink alert"));
  if (platform === "ios") return `https://maps.apple.com/?ll=${p.latitude},${p.longitude}&q=${name}`;
  return `geo:${p.latitude},${p.longitude}?q=${p.latitude},${p.longitude}(${name})`;
}

/** One sentence telling the sender what happened with their location. */
export function describeLocationOutcome({ position, reason, stale, approximate } = {}, now = Date.now()) {
  if (position && position.source === "place") {
    return position.label ? t("Saved place \"{label}\" attached.", { label: position.label }) : t("Saved place attached.");
  }
  if (position && position.source === "manual") return t("Typed-in position attached.");
  if (position) {
    const d = describePosition(position, now);
    if (approximate) {
      return t("Location attached, but only approximately ({accuracy}). Allow precise location in Settings so helpers can find you.", { accuracy: d.accuracy });
    }
    if (stale && d.age) return t("Location attached from {age} (no fresh GPS fix yet).", { age: d.age });
    return d.accuracy ? t("Location attached ({accuracy}).", { accuracy: d.accuracy }) : t("Location attached.");
  }
  switch (reason) {
    case "denied":
      return t("Sent without your location: location permission was declined.");
    case "unavailable":
      return t("Sent without your location: no GPS fix. Try near a window or outdoors.");
    case "timeout":
      return t("Sent without your location: no GPS fix in time.");
    case "no_place":
      return t("Sent without your location: no saved place was chosen.");
    default:
      return t("Sent without your location.");
  }
}
