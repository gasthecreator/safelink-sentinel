// app/scripts/lib/osmToPack.js
// Converts OpenStreetMap data (Overpass JSON: ways with their nodes) into a compact
// "routing pack" the phone can load and route over with no internet.
//
// Pack format 1 (JSON, flat arrays so it parses fast and stays small):
//   bbox    [south, west, north, east] the area asked for, fully covered
//   extent  [south, west, north, east] where data actually exists (a bit larger)
//   nodes   [lat1e6, lon1e6, ...]                        microdegrees, 2 numbers per node
//   edges   [a, b, lenDm, cls, flags, name, ...]         6 numbers per edge
//             a, b      node indices; lenDm = length in decimetres
//             cls       index into `classes`
//             flags     bit0 walkable, bit1 drivable, bit2 one-way a->b (drivers only)
//             name      index into `names` (0 = unnamed)
//   names   ["", "Main St", ...]
//   classes ["residential", ...]
// Pedestrians ignore one-way markings; vehicles obey them.
//
// OpenStreetMap data is © OpenStreetMap contributors, licensed under the ODbL. Anything
// built from it must credit that; the pack carries the credit and the app shows it.

const WALK_NO = new Set(["motorway", "motorway_link", "construction", "proposed", "raceway", "bus_guideway"]);
const DRIVE_YES = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
  "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
  "service", "track",
]);
const SKIP = new Set(["construction", "proposed", "raceway", "bus_guideway", "platform", "elevator", "corridor"]);

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isNo = (v) => v === "no" || v === "private" || v === "false";
const isYes = (v) => v === "yes" || v === "designated" || v === "permissive" || v === "true";

/** Which modes may use a way, and whether it is one-way for vehicles. */
function classifyWay(tags) {
  const hw = tags.highway;
  if (!hw || SKIP.has(hw)) return null;

  let walk = !WALK_NO.has(hw);
  let drive = DRIVE_YES.has(hw);

  // Access restrictions: an explicit "yes" for a mode overrides a blanket "no".
  const blanket = tags.access;
  if (isNo(blanket)) {
    walk = walk && isYes(tags.foot);
    drive = drive && (isYes(tags.motor_vehicle) || isYes(tags.vehicle));
  }
  if (isNo(tags.foot)) walk = false;
  if (isNo(tags.motor_vehicle) || isNo(tags.vehicle)) drive = false;
  if (!walk && !drive) return null;

  const ow = tags.oneway;
  let oneway = 0; // 0 two-way, 1 a->b only, -1 b->a only
  if (ow === "yes" || ow === "true" || ow === "1") oneway = 1;
  else if (ow === "-1" || ow === "reverse") oneway = -1;
  else if (tags.junction === "roundabout" || tags.junction === "circular") oneway = 1;
  else if (hw === "motorway" || hw === "motorway_link") oneway = ow === "no" ? 0 : 1;

  return { walk, drive, oneway };
}

// Places worth finding in an emergency. Kinds are fixed (the app has a name and icon for each).
const PLACE_KINDS = ["hospital", "clinic", "pharmacy", "fire", "police", "shelter", "assembly", "water"];

/** OSM tags -> one of PLACE_KINDS, or null. */
function classifyPlace(tags) {
  if (!tags) return null;
  switch (tags.amenity) {
    case "hospital": return "hospital";
    case "clinic": return "clinic";
    case "pharmacy": return "pharmacy";
    case "fire_station": return "fire";
    case "police": return "police";
    case "drinking_water":
    case "water_point": return "water";
    case "social_facility": return tags.social_facility === "shelter" ? "shelter" : null;
    default: break;
  }
  if (tags.emergency === "assembly_point") return "assembly";
  if (tags.social_facility === "shelter") return "shelter";
  if (tags.healthcare === "hospital") return "hospital";
  return null;
}

const KIND_LABEL = {
  hospital: "Hospital", clinic: "Clinic", pharmacy: "Pharmacy", fire: "Fire station", police: "Police",
  shelter: "Shelter", assembly: "Assembly point", water: "Drinking water",
};

/** Where an OSM element is: a node's own position, or the centre Overpass gives a way/relation. */
function placePosition(e) {
  if (e.type === "node" && Number.isFinite(e.lat) && Number.isFinite(e.lon)) return [e.lat, e.lon];
  if (e.center && Number.isFinite(e.center.lat) && Number.isFinite(e.center.lon)) return [e.center.lat, e.center.lon];
  return null;
}

/**
 * @param {{elements: Array}} osm Overpass JSON with `way` elements and their `node`s
 * @param {{name?: string, bbox?: number[], source?: string, now?: Date}} options
 */
function osmToPack(osm, options = {}) {
  const els = (osm && osm.elements) || [];
  const nodePos = new Map();
  for (const e of els) if (e.type === "node") nodePos.set(e.id, [e.lat, e.lon]);

  const names = [""];
  const nameIndex = new Map([["", 0]]);
  const classes = [];
  const classIndex = new Map();
  const nodeIndex = new Map(); // OSM id -> pack index
  const nodes = [];
  const edges = [];

  const useNode = (id) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      const [lat, lon] = nodePos.get(id);
      i = nodes.length / 2;
      nodeIndex.set(id, i);
      nodes.push(Math.round(lat * 1e6), Math.round(lon * 1e6));
    }
    return i;
  };

  let skippedWays = 0;
  for (const way of els) {
    if (way.type !== "way" || !Array.isArray(way.nodes) || !way.tags) continue;
    const kind = classifyWay(way.tags);
    if (!kind) { skippedWays += 1; continue; }

    const label = (way.tags.name || way.tags.ref || "").trim().slice(0, 80);
    let nameIdx = nameIndex.get(label);
    if (nameIdx === undefined) { nameIdx = names.length; names.push(label); nameIndex.set(label, nameIdx); }
    const cls = way.tags.highway;
    let clsIdx = classIndex.get(cls);
    if (clsIdx === undefined) { clsIdx = classes.length; classes.push(cls); classIndex.set(cls, clsIdx); }

    for (let k = 0; k + 1 < way.nodes.length; k++) {
      let idA = way.nodes[k];
      let idB = way.nodes[k + 1];
      if (idA === idB || !nodePos.has(idA) || !nodePos.has(idB)) continue; // way runs off the edge of the area
      const [latA, lonA] = nodePos.get(idA);
      const [latB, lonB] = nodePos.get(idB);
      const lenDm = Math.max(1, Math.round(haversineM(latA, lonA, latB, lonB) * 10));
      if (kind.oneway === -1) { [idA, idB] = [idB, idA]; } // normalise so one-way always means a->b
      const flags = (kind.walk ? 1 : 0) | (kind.drive ? 2 : 0) | (kind.oneway !== 0 && kind.drive ? 4 : 0);
      edges.push(useNode(idA), useNode(idB), lenDm, clsIdx, flags, nameIdx);
    }
  }

  // Places (hospitals, shelters, water...). The same place often appears as a node and as its
  // building outline: keep one of the same kind and name within 80 m.
  const poiKinds = [];
  const pois = [];
  const seenPlaces = [];
  for (const e of els) {
    const kind = classifyPlace(e.tags);
    const pos = kind && placePosition(e);
    if (!pos) continue;
    const label = (e.tags.name || "").trim().slice(0, 80) || KIND_LABEL[kind];
    if (seenPlaces.some((q) => q.kind === kind && q.label === label && haversineM(q.lat, q.lon, pos[0], pos[1]) < 80)) continue;
    seenPlaces.push({ kind, label, lat: pos[0], lon: pos[1] });
    let nameIdx = nameIndex.get(label);
    if (nameIdx === undefined) { nameIdx = names.length; names.push(label); nameIndex.set(label, nameIdx); }
    let kindIdx = poiKinds.indexOf(kind);
    if (kindIdx < 0) { kindIdx = poiKinds.length; poiKinds.push(kind); }
    pois.push(kindIdx, Math.round(pos[0] * 1e6), Math.round(pos[1] * 1e6), nameIdx);
  }

  // bbox is the area that was asked for and is complete; extent is where data actually
  // exists (roads that cross the edge are included whole, but beyond bbox they are partial).
  const extent = boundsOf(nodes);
  const bbox = options.bbox || extent;
  return {
    format: 1,
    name: options.name || "Map pack",
    bbox,
    extent,
    builtAt: (options.now || new Date()).toISOString(),
    source: options.source || "OpenStreetMap via Overpass API",
    attribution: "© OpenStreetMap contributors (ODbL)",
    stats: { nodes: nodes.length / 2, edges: edges.length / 6, skippedWays, places: pois.length / 4 },
    nodes,
    edges,
    names,
    classes,
    poiKinds,
    pois,
  };
}

function boundsOf(nodes) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (let i = 0; i < nodes.length; i += 2) {
    s = Math.min(s, nodes[i]); n = Math.max(n, nodes[i]);
    w = Math.min(w, nodes[i + 1]); e = Math.max(e, nodes[i + 1]);
  }
  return nodes.length ? [s / 1e6, w / 1e6, n / 1e6, e / 1e6] : [0, 0, 0, 0];
}

module.exports = { osmToPack, classifyWay, classifyPlace, haversineM, PLACE_KINDS, KIND_LABEL };
