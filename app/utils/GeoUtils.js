// app/utils/GeoUtils.js

const EARTH_RADIUS_KM = 6371;

// convert degrees → radians
export function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine distance between two coords in km
export function distanceKm(a, b) {
  if (
    !a ||
    !b ||
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null
  ) {
    return null;
  }

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export function isWithinRadius(a, b, radiusKm) {
  const d = distanceKm(a, b);
  if (d == null) return false;
  return d <= radiusKm;
}

// crude ETA estimate based on mode and distance
export function estimateETA(distanceInKm, mode = "walk") {
  if (!distanceInKm || distanceInKm <= 0) return 0;

  let speedKmH = 4; // walking default

  switch (mode) {
    case "bike":
      speedKmH = 12;
      break;
    case "drive":
      speedKmH = 30; // assume city crisis driving
      break;
    default:
      speedKmH = 4;
  }

  const hours = distanceInKm / speedKmH;
  return Math.round(hours * 60); // minutes
}

// convert ETA minutes into "12 min", "1h 5m"
export function formatETAMinutes(minutes) {
  if (!minutes || minutes <= 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Offline-friendly route stub.
 * For now: straight line from start to end.
 * Later: if internet is available, you can plug a real Directions API here.
 */
export async function getRouteBetweenPoints(start, end) {
  if (!start || !end) return [];
  return [
    { latitude: start.latitude, longitude: start.longitude },
    { latitude: end.latitude, longitude: end.longitude },
  ];
}

// Legacy functions for backward compatibility
export function toRadians(degrees) {
  return toRad(degrees);
}

export function calculateDistance(coord1, coord2) {
  const coord1Formatted = { latitude: coord1.lat, longitude: coord1.lon };
  const coord2Formatted = { latitude: coord2.lat, longitude: coord2.lon };
  return distanceKm(coord1Formatted, coord2Formatted);
}

export function calculateDistanceLatLon(coord1, coord2) {
  return distanceKm(coord1, coord2);
}

export function formatCoordinates(lat, lon) {
  return `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
}

export function formatDistance(distanceKm) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`;
  }
  return `${distanceKm.toFixed(1)}km`;
}

export function getEstimatedTime(distanceKm, mode = "walking") {
  const modeMap = {
    walking: "walk",
    cycling: "bike",
    driving: "drive",
  };
  const minutes = estimateETA(distanceKm, modeMap[mode] || "walk");
  return formatETAMinutes(minutes);
}
