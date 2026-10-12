// app/services/location/places.js
// Pure helpers for places the user names and for coordinates typed by hand.

import { sanitizePosition, sanitizeText, MAX_LABEL } from "./position.js";

/**
 * Parse "30.5, -92.2", "30.5 -92.2" or "30.5N 92.2W" into { latitude, longitude },
 * or null if it isn't two valid decimal-degree numbers. (Degrees/minutes/seconds
 * are deliberately not guessed at: a misread would send help to the wrong place.)
 */
export function parseCoordinates(input) {
  if (typeof input !== "string") return null;
  const text = input.trim().replace(/[°]/g, "");
  const m = text.match(
    /^([+-]?\d{1,3}(?:\.\d+)?)\s*([NSns])?\s*[,;\s]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*([EWew])?$/
  );
  if (!m) return null;
  let latitude = Number(m[1]);
  let longitude = Number(m[3]);
  if (m[2] && /s/i.test(m[2])) latitude = -Math.abs(latitude);
  if (m[4] && /w/i.test(m[4])) longitude = -Math.abs(longitude);
  const position = sanitizePosition({ latitude, longitude });
  return position ? { latitude: position.latitude, longitude: position.longitude } : null;
}

/** A saved place from untrusted/stored data, or null. */
export function sanitizePlace(place) {
  if (!place || typeof place !== "object") return null;
  const position = sanitizePosition(place);
  const name = sanitizeText(place.name, MAX_LABEL);
  if (!position || !name || typeof place.id !== "string") return null;
  return {
    id: place.id.slice(0, 64),
    name,
    latitude: position.latitude,
    longitude: position.longitude,
    accuracyM: position.accuracyM,
    kind: place.kind === "manual" ? "manual" : "gps",
    createdAt: typeof place.createdAt === "number" && Number.isFinite(place.createdAt) ? place.createdAt : null,
  };
}

/** The position to attach to an alert when the user picks this saved place. */
export function placeToPosition(place) {
  const p = sanitizePlace(place);
  if (!p) return null;
  return sanitizePosition({
    latitude: p.latitude,
    longitude: p.longitude,
    accuracyM: p.accuracyM,
    fixedAt: null,
    source: p.kind === "manual" ? "manual" : "place",
    label: p.name,
  });
}
