import { loadPack } from "../services/navigation/pack.js";
import { route } from "../services/navigation/router.js";
import { mergeGraphs, bboxesTouch, unionBbox } from "../services/navigation/mergePacks.js";
import { findPackFor, setInstalledSource } from "../services/navigation/packs.js";
import { nearestPlaces } from "../services/navigation/places.js";

const raw = require("../assets/maps/grambling-la.json");
const whole = loadPack(raw).graph;

// Cut a real pack into the pack for one side of a vertical line, the way the builder does: a road that has
// any point on this side is included WHOLE (so roads crossing the line are in both halves), and the area
// (bbox) is this side's.
function slice(pack, { west = -Infinity, east = Infinity }, name) {
  const lon = (i) => pack.nodes[2 * i + 1] / 1e6;
  const keepEdges = [];
  for (let e = 0; e < pack.edges.length; e += 6) {
    const a = lon(pack.edges[e]);
    const b = lon(pack.edges[e + 1]);
    if ([a, b].some((x) => x >= west && x <= east)) keepEdges.push(pack.edges.slice(e, e + 6));
  }
  const map = new Map();
  const nodes = [];
  const use = (i) => {
    if (!map.has(i)) { map.set(i, nodes.length / 2); nodes.push(pack.nodes[2 * i], pack.nodes[2 * i + 1]); }
    return map.get(i);
  };
  const edges = keepEdges.flatMap(([a, b, ...rest]) => [use(a), use(b), ...rest]);
  const [s, w, n, e] = pack.bbox;
  return {
    ...pack, name, nodes, edges,
    bbox: [s, Math.max(w, west), n, Math.min(e, east)],
    pois: undefined, poiKinds: undefined,
  };
}
const SPLIT = -92.7175;
const westPack = slice(raw, { east: SPLIT }, "West half");
const eastPack = slice(raw, { west: SPLIT }, "East half");
const west = loadPack(westPack).graph;
const east = loadPack(eastPack).graph;

const P = (latitude, longitude) => ({ latitude, longitude });
const A = P(32.5266, -92.7400); // far west
const B = P(32.5405, -92.6975); // far east: needs both halves

describe("the real map, cut in two", () => {
  test("neither half alone can make the trip, and they really are two different maps", () => {
    expect(west.edgeCount).toBeLessThan(whole.edgeCount);
    expect(east.edgeCount).toBeLessThan(whole.edgeCount);
    expect(west.edgeCount + east.edgeCount).toBeGreaterThan(whole.edgeCount); // crossing roads are in both
    expect(route(west, A, B, { mode: "walk" }).ok).toBe(false);
    expect(route(east, A, B, { mode: "walk" }).ok).toBe(false);
  });

  test("merged, the halves are the original network: same roads, none twice", () => {
    const merged = mergeGraphs([west, east]);
    expect(merged.edgeCount).toBe(whole.edgeCount);
    expect(merged.nodeCount).toBe(whole.nodeCount);
    expect(merged.merged).toBe(2);
  });

  test.each(["walk", "drive"])("%s routes across the join are exactly the original's (many pairs)", (mode) => {
    const merged = mergeGraphs([west, east]);
    const points = [];
    for (let i = 0; i < 12; i++) points.push(P(32.508 + (i * 0.0027) % 0.035, -92.742 + (i * 0.0041) % 0.05));
    let compared = 0;
    let crossed = 0;
    for (const from of points) {
      for (const to of points) {
        const ref = route(whole, from, to, { mode });
        const got = route(merged, from, to, { mode });
        expect(got.ok).toBe(ref.ok);
        if (ref.ok) {
          expect(got.distanceM).toBe(ref.distanceM);
          expect(got.steps.map((s) => s.text)).toEqual(ref.steps.map((s) => s.text));
          compared++;
          if ((from.longitude < SPLIT) !== (to.longitude < SPLIT)) crossed++;
        }
      }
    }
    expect(compared).toBeGreaterThan(80);
    expect(crossed).toBeGreaterThan(30); // a good share of the trips really did cross the join
  });

  test("the inputs are left alone", () => {
    const before = [west.edgeCount, east.edgeCount, west.names.length];
    mergeGraphs([west, east]);
    expect([west.edgeCount, east.edgeCount, west.names.length]).toEqual(before);
  });
});

describe("findPackFor joins neighbouring maps", () => {
  // The same two halves, moved a whole degree north so the bundled Grambling map cannot cover the trip itself.
  const lift = (pack, dLat, dLon = 0) => ({
    ...pack,
    nodes: pack.nodes.map((v, i) => (i % 2 === 0 ? v + Math.round(dLat * 1e6) : v + Math.round(dLon * 1e6))),
    bbox: [pack.bbox[0] + dLat, pack.bbox[1] + dLon, pack.bbox[2] + dLat, pack.bbox[3] + dLon],
  });
  const entry = (id, pack) => ({ id, name: pack.name, version: 1, bbox: pack.bbox, sizeBytes: 1 });
  const source = (packs) => ({
    installed: async () => Object.entries(packs).map(([id, p]) => entry(id, p)),
    read: async (id) => packs[id],
  });
  const a = P(A.latitude + 1, A.longitude);
  const b = P(B.latitude + 1, B.longitude);

  test("a trip no single map covers is routed over the two that together do", async () => {
    setInstalledSource(source({ west: lift(westPack, 1), east: lift(eastPack, 1) }));
    const found = await findPackFor([a, b]);
    expect(found.pack).not.toBeNull();
    expect(found.pack.merged).toBe(2);
    const r = route(found.pack, a, b, { mode: "walk" });
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBe(route(whole, A, B, { mode: "walk" }).distanceM); // the same trip as on the original
  });

  test("a trip one map covers does not pay for a merge", async () => {
    setInstalledSource(source({ west: lift(westPack, 1), east: lift(eastPack, 1) }));
    const found = await findPackFor([a, P(a.latitude + 0.002, a.longitude + 0.002)]);
    expect(found.pack).not.toBeNull();
    expect(found.pack.merged).toBeUndefined();
  });

  test("two maps with a gap between them are never joined", async () => {
    setInstalledSource(source({ west: lift(westPack, 1), east: lift(eastPack, 1, 0.5) })); // half a degree apart
    const found = await findPackFor([a, P(b.latitude, b.longitude + 0.5)]);
    expect(found.pack).toBeNull();
    expect(found.partial).not.toBeNull(); // the screen can say only one end is covered
  });

  test("a point in no map at all is never routed", async () => {
    setInstalledSource(source({ west: lift(westPack, 1), east: lift(eastPack, 1) }));
    const found = await findPackFor([a, P(10, 10)]);
    expect(found.pack).toBeNull();
  });

  test("the merged map is built once and reused", async () => {
    setInstalledSource(source({ west: lift(westPack, 1), east: lift(eastPack, 1) }));
    const first = await findPackFor([a, b]);
    const second = await findPackFor([a, b]);
    expect(second.pack).toBe(first.pack);
  });
});

describe("bbox helpers and merged extras", () => {
  test("touching, overlapping and apart", () => {
    expect(bboxesTouch([0, 0, 1, 1], [0, 1, 1, 2], 0)).toBe(true); // share an edge
    expect(bboxesTouch([0, 0, 1, 1], [0.5, 0.5, 2, 2], 0)).toBe(true); // overlap
    expect(bboxesTouch([0, 0, 1, 1], [0, 1.001, 1, 2], 0)).toBe(false);
    expect(bboxesTouch([0, 0, 1, 1], [0, 1.001, 1, 2], 0.003)).toBe(true); // within the margin
    expect(unionBbox([[0, 0, 1, 1], [0.5, 0.5, 2, 3]])).toEqual([0, 0, 2, 3]);
  });
  test("places from both maps survive, once each", () => {
    const n = raw.names.length; // the new names are appended after the map's own, so A, B, C are n, n+1, n+2
    const one = loadPack({ ...raw, name: "one", poiKinds: ["police"], pois: [0, 32526600, -92716500, n, 0, 32520000, -92710000, n + 1], names: [...raw.names, "A", "B"] }).graph;
    const two = loadPack({ ...raw, name: "two", poiKinds: ["police"], pois: [0, 32526600, -92716500, n, 0, 32540000, -92700000, n + 2], names: [...raw.names, "A", "B", "C"] }).graph;
    expect(one.pois.count + two.pois.count).toBe(4);
    const merged = mergeGraphs([one, two]);
    expect(merged.pois.count).toBe(3); // "A" at the same spot in both is one place
    const names = nearestPlaces(merged, P(32.527, -92.716), "police", { limit: 10 }).map((p) => p.name).sort();
    expect(names).toEqual(["A", "B", "C"]);
  });
  test("nothing to merge is an error; one map is returned as is", () => {
    expect(() => mergeGraphs([])).toThrow();
    expect(mergeGraphs([west])).toBe(west);
  });
});
