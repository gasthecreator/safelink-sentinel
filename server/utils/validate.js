// server/utils/validate.js
// Everything a client sends is checked and copied field by field. Unknown fields are dropped, so a request
// cannot stuff arbitrary data (or megabytes of it) into the files, and text is cleaned of control and
// direction-changing characters before it is stored or shown to someone else.

// Built from code points (not literal characters) so no editor or tool can turn them into real line breaks.
const range = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const CONTROL = new RegExp(
  `[${range(0x00, 0x08)}${range(0x0b, 0x0c)}${range(0x0e, 0x1f)}${range(0x7f, 0x9f)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
  "g"
);
const INVISIBLE = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2060, 0x2064)}${range(0x2066, 0x2069)}${String.fromCharCode(0xfeff)}]`,
  "g"
);

/** A cleaned string up to `max` characters, or null if it is missing, not a string, or empty after cleaning. */
function text(value, max = 500, { multiline = false } = {}) {
  if (typeof value !== "string") return null;
  let s = value.replace(CONTROL, " ").replace(INVISIBLE, "");
  s = multiline ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  s = s.trim().slice(0, max);
  return s || null;
}

// Ids end up as keys of plain objects in the data files; these names would corrupt such an object.
const RESERVED = new Set(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"]);

/** An identifier: letters, digits and a few separators, 1-128 characters. */
function id(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:@-]{1,128}$/.test(value) && !RESERVED.has(value) ? value : null;
}

/** A number (or a numeric string) inside [min, max], else null. */
function number(value, min, max) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const latitude = (v) => number(v, -90, 90);
const longitude = (v) => number(v, -180, 180);

/** One of the allowed strings (exact match), else null. */
function oneOf(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

/** An ISO date within a day of now (a phone's clock may be off), else null. */
function recentIso(value, now = Date.now()) {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return Math.abs(now - t) <= 366 * 86400000 ? new Date(t).toISOString() : null;
}

/** A positive integer limit from a query string, capped. */
function limit(value, fallback = 100, max = 500) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

module.exports = { text, id, number, latitude, longitude, oneOf, recentIso, limit };
