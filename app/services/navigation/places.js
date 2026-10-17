// app/services/navigation/places.js
// Finding the nearest hospital, shelter, water and so on in an offline map pack, straight from
// the pack: no internet. Distance is as the crow flies (the route to a chosen place is then worked
// out by the normal router).

import { distanceM, bearingDeg, compassName } from "./router.js";
import { N_ } from "../i18n/i18n.js";

export const PLACE_INFO = {
  hospital: { label: N_("Hospital"), plural: N_("Hospitals") },
  clinic: { label: N_("Clinic"), plural: N_("Clinics") },
  pharmacy: { label: N_("Pharmacy"), plural: N_("Pharmacies") },
  fire: { label: N_("Fire station"), plural: N_("Fire stations") },
  police: { label: N_("Police"), plural: N_("Police") },
  shelter: { label: N_("Shelter"), plural: N_("Shelters") },
  assembly: { label: N_("Assembly point"), plural: N_("Assembly points") },
  water: { label: N_("Drinking water"), plural: N_("Drinking water") },
};

/** Which kinds of place this pack has, with how many: [{ kind, label, plural, count }] in a useful order. */
export function placeKinds(graph) {
  const pois = graph && graph.pois;
  if (!pois || pois.count === 0) return [];
  const counts = new Map();
  for (let i = 0; i < pois.count; i++) {
    const kind = pois.kinds[pois.kind[i]];
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return Object.keys(PLACE_INFO)
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ kind, ...PLACE_INFO[kind], count: counts.get(kind) }));
}

/**
 * The nearest places of a kind (or of any kind) to a position, nearest first.
 * @returns {{kind, label, name, latitude, longitude, distanceM, bearing, direction}[]}
 */
export function nearestPlaces(graph, position, kind = null, { limit = 5, maxM = Infinity } = {}) {
  const pois = graph && graph.pois;
  if (!pois || pois.count === 0 || !position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return [];
  const found = [];
  for (let i = 0; i < pois.count; i++) {
    const k = pois.kinds[pois.kind[i]];
    if (kind && k !== kind) continue;
    const d = distanceM(position.latitude, position.longitude, pois.lat[i], pois.lon[i]);
    if (d > maxM) continue;
    found.push({ i, k, d });
  }
  found.sort((a, b) => a.d - b.d);
  return found.slice(0, limit).map(({ i, k, d }) => {
    const bearing = bearingDeg(position.latitude, position.longitude, pois.lat[i], pois.lon[i]);
    return {
      kind: k,
      label: PLACE_INFO[k].label,
      name: graph.names[pois.name[i]] || PLACE_INFO[k].label,
      latitude: pois.lat[i],
      longitude: pois.lon[i],
      distanceM: Math.round(d),
      bearing: Math.round(bearing),
      direction: compassName(bearing),
    };
  });
}
