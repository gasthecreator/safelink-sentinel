// app/services/units/units.js
// Distances in metric (m, km) or imperial (ft, mi), for showing and for speaking.
// Pure functions. Everything in the app measures in metres; this only changes the words.

export const METRIC = "metric";
export const IMPERIAL = "imperial";

const M_PER_FOOT = 0.3048;
const M_PER_MILE = 1609.344;

// Regions that give road distances in miles and feet.
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM", "GB"]);

/** "en-US" / "en_US" / "en" -> metric or imperial (metric when the region is unknown). */
export function unitsForLocale(locale) {
  const region = typeof locale === "string" ? (locale.split(/[-_]/)[1] || "").toUpperCase() : "";
  return IMPERIAL_REGIONS.has(region) ? IMPERIAL : METRIC;
}

// The units in force, set by the preference store. Defaults to metric so tests and non-app code are stable.
let current = METRIC;
export const getCurrentUnits = () => current;
export function setCurrentUnits(units) {
  current = units === IMPERIAL ? IMPERIAL : METRIC;
}

const pick = (units) => (units === IMPERIAL || units === METRIC ? units : current);

const trim = (x) => String(Math.round(x * 10) / 10);

/** "250 m", "1.5 km" / "300 ft", "0.4 mi". */
export function formatDistance(m, units) {
  if (!(typeof m === "number" && m >= 0)) return "";
  if (pick(units) === IMPERIAL) {
    const ft = m / M_PER_FOOT;
    if (ft < 100) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
    if (ft < 1000) return `${Math.round(ft / 50) * 50} ft`;
    const mi = m / M_PER_MILE;
    return `${mi < 10 ? trim(mi) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.round(m / 10) * 10 || Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** The same, as it would be said aloud: "60 meters", "300 feet", "1.5 miles". */
export function spokenDistance(m, units) {
  if (!(typeof m === "number" && m >= 0)) return "";
  if (pick(units) === IMPERIAL) {
    const ft = m / M_PER_FOOT;
    if (ft < 100) return `${Math.max(10, Math.round(ft / 10) * 10)} feet`;
    if (ft < 1000) return `${Math.round(ft / 50) * 50} feet`;
    const mi = Math.round((m / M_PER_MILE) * 10) / 10;
    return `${mi} mile${mi === 1 ? "" : "s"}`;
  }
  if (m < 100) return `${Math.max(10, Math.round(m / 10) * 10)} meters`;
  if (m < 1000) return `${Math.round(m / 50) * 50} meters`;
  const km = Math.round(m / 100) / 10;
  return `${km} kilometre${km === 1 ? "" : "s"}`;
}

/** Round-number steps for a map scale bar, with their length in metres and their label. */
export function scaleSteps(units) {
  if (pick(units) === IMPERIAL) {
    const feet = [50, 100, 200, 500, 1000].map((ft) => ({ m: ft * M_PER_FOOT, label: `${ft} ft` }));
    const miles = [0.5, 1, 2, 5, 10, 20, 50].map((mi) => ({ m: mi * M_PER_MILE, label: `${mi} mi` }));
    return [{ m: 10 * M_PER_FOOT, label: "10 ft" }, { m: 20 * M_PER_FOOT, label: "20 ft" }, ...feet, ...miles];
  }
  return [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].map((m) => ({
    m,
    label: m >= 1000 ? `${m / 1000} km` : `${m} m`,
  }));
}

/** "±5 m" / "±16 ft": how precise a GPS position is. */
export function formatAccuracy(m, units) {
  if (!(typeof m === "number" && m >= 0)) return "";
  if (pick(units) === IMPERIAL) {
    const ft = m / M_PER_FOOT;
    return ft >= 1000 ? `±${trim(m / M_PER_MILE)} mi` : `±${Math.round(ft)} ft`;
  }
  return m >= 1000 ? `±${(m / 1000).toFixed(1)} km` : `±${Math.round(m)} m`;
}
