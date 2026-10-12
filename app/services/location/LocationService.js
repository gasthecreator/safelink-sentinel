// app/services/location/LocationService.js
// Reads the phone's GPS position for an alert. GPS needs no internet, but it does
// need the location permission; the geolocation module asks for it on first use.
// A cold GPS start with no network can take a while, so we try for a fresh fix
// first and then fall back to the phone's last known one, labelled with its age.

import Geolocation from "@react-native-community/geolocation";
import { sanitizePosition, APPROXIMATE_ABOVE_M } from "./position.js";

const FRESH_TIMEOUT_MS = 20000;
const CACHED_TIMEOUT_MS = 5000;
const CACHED_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_AFTER_MS = 2 * 60 * 1000;

// PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3 (W3C geolocation codes)
function reasonFor(error) {
  switch (error && error.code) {
    case 1:
      return "denied";
    case 2:
      return "unavailable";
    case 3:
      return "timeout";
    default:
      return "error";
  }
}

function read(options) {
  return new Promise((resolve) => {
    try {
      Geolocation.getCurrentPosition(
        (fix) =>
          resolve({
            position: sanitizePosition({
              latitude: fix.coords.latitude,
              longitude: fix.coords.longitude,
              accuracyM: fix.coords.accuracy,
              fixedAt: fix.timestamp,
            }),
          }),
        (error) => resolve({ reason: reasonFor(error) }),
        options
      );
    } catch {
      resolve({ reason: "error" });
    }
  });
}

/**
 * Best available position for an alert.
 * Returns { position, reason, stale, approximate }:
 *   position     sanitized position, or null
 *   reason       why there is none: denied | unavailable | timeout | error
 *   stale        true if the fix is more than 2 minutes old
 *   approximate  true if the phone only gave an area, not a point
 */
export async function getPositionForAlert(now = () => Date.now()) {
  let result = await read({ enableHighAccuracy: true, timeout: FRESH_TIMEOUT_MS, maximumAge: 0 });

  // A declined permission won't change by trying again.
  if (!result.position && result.reason !== "denied") {
    const cached = await read({
      enableHighAccuracy: false,
      timeout: CACHED_TIMEOUT_MS,
      maximumAge: CACHED_MAX_AGE_MS,
    });
    if (cached.position) result = cached;
    else result = { reason: result.reason };
  }

  const { position, reason } = result;
  if (!position) return { position: null, reason: reason || "error", stale: false, approximate: false };
  return {
    position,
    reason: null,
    stale: position.fixedAt != null && now() - position.fixedAt > STALE_AFTER_MS,
    approximate: position.accuracyM != null && position.accuracyM > APPROXIMATE_ABOVE_M,
  };
}
