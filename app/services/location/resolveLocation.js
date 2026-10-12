// app/services/location/resolveLocation.js
// Decides what position (if any) goes with an alert, from what the user chose:
//   include = false           -> no position
//   source  = "place"         -> the saved place they picked (no GPS needed)
//   source  = "gps" (default) -> the phone's GPS; if there is no fix, ask the user what
//                               to do (send without, pick a saved place, or cancel)

import { placeToPosition } from "./places.js";

/**
 * @param {{include: boolean, source?: "gps"|"place", place?: object}} choice
 * @param {{getGps?: Function, onNoFix?: (fix) => Promise<"send"|"places"|"cancel">}} deps
 * @returns {Promise<{cancelled: boolean, switchToPlaces: boolean, fix: object|null}>}
 */
export async function resolveAlertLocation({ include, source = "gps", place } = {}, { getGps, onNoFix } = {}) {
  const done = (fix, extra = {}) => ({ cancelled: false, switchToPlaces: false, fix, ...extra });

  if (!include) return done(null);

  if (source === "place") {
    const position = placeToPosition(place);
    return position
      ? done({ position, reason: null, stale: false, approximate: false })
      : done({ position: null, reason: "no_place", stale: false, approximate: false });
  }

  const read = getGps || require("./LocationService.js").getPositionForAlert;
  const fix = await read();
  if (fix.position || !onNoFix) return done(fix);

  const choice = await onNoFix(fix);
  if (choice === "cancel") return done(fix, { cancelled: true });
  if (choice === "places") return done(fix, { cancelled: true, switchToPlaces: true });
  return done(fix);
}
