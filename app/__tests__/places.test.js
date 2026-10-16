import { loadPack } from "../services/navigation/pack.js";
import { placeKinds, nearestPlaces, PLACE_INFO } from "../services/navigation/places.js";

const { osmToPack, classifyPlace, PLACE_KINDS } = require("../scripts/lib/osmToPack.js");
const { splitBbox, mergeOverpass } = require("../scripts/lib/tiles.js");

// two roads plus a few places, as Overpass would return them
const road = (id, a, b) => ({ type: "way", id, nodes: [a, b], tags: { highway: "residential", name: `R${id}` } });
const baseOsm = () => ({
  elements: [
    { type: "node", id: 1, lat: 32.52, lon: -92.71 },
    { type: "node", id: 2, lat: 32.53, lon: -92.71 },
    { type: "node", id: 3, lat: 32.53, lon: -92.70 },
    road(100, 1, 2),
    road(101, 2, 3),
    { type: "node", id: 10, lat: 32.5205, lon: -92.7105, tags: { amenity: "hospital", name: "Lincoln General" } },
    { type: "way", id: 200, center: { lat: 32.5291, lon: -92.7002 }, tags: { amenity: "fire_station", name: "Station 4" } },
    { type: "node", id: 11, lat: 32.5250, lon: -92.7050, tags: { amenity: "drinking_water" } },
    { type: "node", id: 12, lat: 32.5260, lon: -92.7060, tags: { amenity: "social_facility", social_facility: "shelter", name: "Church shelter" } },
    { type: "node", id: 13, lat: 32.5270, lon: -92.7070, tags: { emergency: "assembly_point", name: "Parking lot A" } },
    { type: "node", id: 14, lat: 32.5280, lon: -92.7080, tags: { amenity: "cafe", name: "Not a place we want" } },
  ],
});

describe("classifyPlace", () => {
  test.each([
    [{ amenity: "hospital" }, "hospital"], [{ amenity: "clinic" }, "clinic"], [{ amenity: "pharmacy" }, "pharmacy"],
    [{ amenity: "fire_station" }, "fire"], [{ amenity: "police" }, "police"], [{ amenity: "drinking_water" }, "water"],
    [{ amenity: "water_point" }, "water"], [{ amenity: "social_facility", social_facility: "shelter" }, "shelter"],
    [{ emergency: "assembly_point" }, "assembly"], [{ healthcare: "hospital" }, "hospital"],
    [{ amenity: "social_facility", social_facility: "food_bank" }, null], [{ amenity: "cafe" }, null], [{}, null], [null, null],
  ])("%j -> %s", (tags, kind) => expect(classifyPlace(tags)).toBe(kind));
  test("every kind has a label for the app", () => {
    for (const k of PLACE_KINDS) expect(PLACE_INFO[k].label).toBeTruthy();
  });
});

describe("building a pack with places", () => {
  const pack = osmToPack(baseOsm(), { name: "t", bbox: [32.5, -92.8, 32.6, -92.6] });
  test("keeps the places we want, nodes and outlines alike, and names them", () => {
    expect(pack.stats.places).toBe(5);
    expect(pack.poiKinds.sort()).toEqual(["assembly", "fire", "hospital", "shelter", "water"]);
    const named = [];
    for (let i = 0; i < pack.pois.length; i += 4) named.push(pack.names[pack.pois[i + 3]]);
    expect(named.sort()).toEqual(["Church shelter", "Drinking water", "Lincoln General", "Parking lot A", "Station 4"]);
  });
  test("the same place as a node and as a building outline is kept once", () => {
    const osm = baseOsm();
    osm.elements.push({ type: "way", id: 201, center: { lat: 32.52052, lon: -92.71052 }, tags: { amenity: "hospital", name: "Lincoln General" } });
    expect(osmToPack(osm, { bbox: [32.5, -92.8, 32.6, -92.6] }).stats.places).toBe(5);
  });
  test("two different hospitals with the same name far apart are both kept", () => {
    const osm = baseOsm();
    osm.elements.push({ type: "node", id: 99, lat: 32.58, lon: -92.65, tags: { amenity: "hospital", name: "Lincoln General" } });
    expect(osmToPack(osm, { bbox: [32.5, -92.8, 32.6, -92.6] }).stats.places).toBe(6);
  });
  test("a pack without places is still valid and still routes", () => {
    const plain = osmToPack({ elements: baseOsm().elements.filter((e) => !e.tags || e.tags.highway) }, { bbox: [32.5, -92.8, 32.6, -92.6] });
    const loaded = loadPack(plain);
    expect(loaded.ok).toBe(true);
    expect(loaded.graph.pois.count).toBe(0);
  });
  test("an old pack with no places fields at all loads", () => {
    const old = { ...pack };
    delete old.pois; delete old.poiKinds;
    const loaded = loadPack(old);
    expect(loaded.ok).toBe(true);
    expect(placeKinds(loaded.graph)).toEqual([]);
  });
});

describe("loading places safely", () => {
  const good = () => JSON.parse(JSON.stringify(osmToPack(baseOsm(), { name: "t", bbox: [32.5, -92.8, 32.6, -92.6] })));
  test("a good pack loads with its places", () => {
    const r = loadPack(good());
    expect(r.ok).toBe(true);
    expect(r.graph.pois.count).toBe(5);
  });
  test.each([
    ["unknown kind", (p) => { p.poiKinds[0] = "<script>"; }],
    ["kind index out of range", (p) => { p.pois[0] = 99; }],
    ["name index out of range", (p) => { p.pois[3] = 99999; }],
    ["not a whole number of places", (p) => { p.pois.push(1); }],
    ["non-integer position", (p) => { p.pois[1] = 32.5; }],
    ["latitude beyond the poles", (p) => { p.pois[1] = 91e6; }],
    ["places without kinds", (p) => { delete p.poiKinds; }],
    ["too many kinds", (p) => { p.poiKinds = [...PLACE_KINDS, "hospital"]; }],
  ])("refuses %s", (_name, corrupt) => {
    const p = good();
    corrupt(p);
    expect(loadPack(p).ok).toBe(false);
  });
});

describe("tiles keep the places", () => {
  test("joining tiles gives the same places as one fetch, and a tagged node wins over a bare one", () => {
    const osm = baseOsm();
    const bbox = [32.5, -92.8, 32.6, -92.6];
    const inBox = (lat, lon, [s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e;
    const part = (box) => ({
      elements: osm.elements.filter((e) => {
        const pos = e.type === "node" ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null;
        if (e.type === "way" && e.nodes) return true; // roads come with every tile that touches them
        return pos ? inBox(pos[0], pos[1], box) : true;
      }),
    });
    const merged = mergeOverpass(splitBbox(bbox, 0.001).map(part));
    expect(osmToPack(merged, { bbox }).stats.places).toBe(5);
    // the same node twice, once bare (as a road point) and once with tags (as a place): the place survives
    const m = mergeOverpass([
      { elements: [{ type: "node", id: 5, lat: 1, lon: 1 }] },
      { elements: [{ type: "node", id: 5, lat: 1, lon: 1, tags: { amenity: "hospital" } }] },
      { elements: [{ type: "node", id: 5, lat: 1, lon: 1 }] },
    ]);
    expect(m.elements.find((e) => e.id === 5).tags.amenity).toBe("hospital");
  });
});

describe("finding the nearest", () => {
  const graph = loadPack(osmToPack(baseOsm(), { name: "t", bbox: [32.5, -92.8, 32.6, -92.6] })).graph;
  test("kinds present, in a useful order, with counts", () => {
    expect(placeKinds(graph).map((k) => [k.kind, k.count])).toEqual([["hospital", 1], ["fire", 1], ["shelter", 1], ["assembly", 1], ["water", 1]]);
  });
  test("nearest first, with distance and direction", () => {
    const here = { latitude: 32.5262, longitude: -92.7062 };
    const all = nearestPlaces(graph, here, null, { limit: 10 });
    expect(all.map((p) => p.name)).toEqual(["Church shelter", "Parking lot A", "Drinking water", "Station 4", "Lincoln General"]); // about 30, 110, 160, 560 and 700 m
    expect(all[0].distanceM).toBeLessThan(40);
    expect(all.every((p, i, a) => i === 0 || p.distanceM >= a[i - 1].distanceM)).toBe(true);
    const hospital = nearestPlaces(graph, here, "hospital")[0];
    expect(hospital.name).toBe("Lincoln General");
    expect(hospital.direction).toBe("south-west");
  });
  test("limits and range", () => {
    const here = { latitude: 32.5262, longitude: -92.7062 };
    expect(nearestPlaces(graph, here, null, { limit: 2 })).toHaveLength(2);
    expect(nearestPlaces(graph, here, null, { maxM: 100 }).length).toBeLessThan(5);
  });
  test("bad input gives nothing, not a crash", () => {
    expect(nearestPlaces(graph, null)).toEqual([]);
    expect(nearestPlaces(graph, { latitude: NaN, longitude: 1 })).toEqual([]);
    expect(nearestPlaces(null, { latitude: 1, longitude: 1 })).toEqual([]);
    expect(placeKinds(null)).toEqual([]);
  });
});

describe("the bundled Grambling sample", () => {
  const graph = loadPack(require("../assets/maps/grambling-la.json")).graph;
  test("has real places from OpenStreetMap, and the campus police are nearest to campus", () => {
    expect(graph.pois.count).toBeGreaterThanOrEqual(4);
    const near = nearestPlaces(graph, { latitude: 32.5220, longitude: -92.7130 }, "police")[0];
    expect(near.name).toBe("GSU Police");
    expect(near.distanceM).toBeLessThan(100);
  });
});
