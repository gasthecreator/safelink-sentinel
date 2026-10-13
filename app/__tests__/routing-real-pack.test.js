// The router against the real Grambling, LA pack built from OpenStreetMap, with an
// independent Dijkstra (written here, sharing no code with the router) as the referee.
import { loadPack, modeIndex } from "../services/navigation/pack.js";
import { route, distanceM } from "../services/navigation/router.js";

const raw = require("../assets/maps/grambling-la.json");

const loaded = loadPack(raw);
const graph = loaded.graph;

// ---- reference Dijkstra over the same arcs and the same cost model
const DRIVE_SPEED = {
  motorway: 27, motorway_link: 17, trunk: 22, trunk_link: 14, primary: 16, primary_link: 11, secondary: 13.5,
  secondary_link: 9, tertiary: 11, tertiary_link: 8, unclassified: 10, residential: 8.5, living_street: 4,
  service: 4, track: 3,
};
const speed = (e, mode) => {
  const cls = graph.classes[graph.cls[e]];
  return mode === "drive" ? DRIVE_SPEED[cls] || 8 : cls === "steps" ? 0.8 : 1.4;
};
function dijkstra(mode, src, dst) {
  const idx = modeIndex(graph, mode);
  const dist = new Map([[src, 0]]);
  const todo = new Set([src]);
  const done = new Set();
  while (todo.size) {
    let u = -1;
    let best = Infinity;
    for (const v of todo) if (dist.get(v) < best) { best = dist.get(v); u = v; }
    todo.delete(u);
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) return best;
    for (let k = idx.offsets[u]; k < idx.offsets[u + 1]; k++) {
      const v = idx.to[k];
      const c = best + graph.len[idx.arcEdge[k]] / speed(idx.arcEdge[k], mode);
      if (c < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, c); todo.add(v); }
    }
  }
  return Infinity;
}

// the longest real road segment in the data (rural roads have few points), the limit for any one hop
const longestSegment = Math.max(...graph.len);

// seeded random so a failure is reproducible
let seed = 20261012;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

// nodes in the biggest network for a mode that are inside the pack's guaranteed area
function mainNodes(mode) {
  const idx = modeIndex(graph, mode);
  const [s, w, n, e] = graph.bbox;
  const out = [];
  for (let i = 0; i < graph.nodeCount; i++) {
    if (idx.offsets[i + 1] === idx.offsets[i] || !idx.hasIn[i]) continue;
    if (idx.componentSize.get(idx.component[i]) !== idx.largest) continue;
    if (graph.lat[i] < s || graph.lat[i] > n || graph.lon[i] < w || graph.lon[i] > e) continue;
    out.push(i);
  }
  return out;
}
const at = (i) => ({ latitude: graph.lat[i], longitude: graph.lon[i] });

describe("the sample pack", () => {
  test("loads and describes itself", () => {
    expect(loaded.ok).toBe(true);
    expect(graph.name).toBe("Grambling, LA (sample)");
    expect(graph.attribution).toMatch(/OpenStreetMap/);
    expect(graph.nodeCount).toBeGreaterThan(1500);
    expect(graph.edgeCount).toBeGreaterThan(1500);
  });
  test("has real streets from Grambling", () => {
    expect(graph.names).toEqual(expect.arrayContaining(["Fidelia Street", "Hollis Jensen Street"]));
  });
  test("walking and driving both have a large connected network", () => {
    expect(modeIndex(graph, "walk").largest).toBeGreaterThan(1000);
    expect(modeIndex(graph, "drive").largest).toBeGreaterThan(1000);
  });
});

describe.each(["walk", "drive"])("routing by %s agrees with an independent shortest-path search", (mode) => {
  const nodes = mainNodes(mode);
  test("40 random trips: same quickest time, sane geometry and directions", () => {
    expect(nodes.length).toBeGreaterThan(500);
    let routed = 0;
    for (let trip = 0; trip < 40; trip++) {
      const a = nodes[Math.floor(rand() * nodes.length)];
      const b = nodes[Math.floor(rand() * nodes.length)];
      if (a === b) continue;
      const expected = dijkstra(mode, a, b);
      const got = route(graph, at(a), at(b), { mode });
      if (!Number.isFinite(expected)) {
        expect(got.ok).toBe(false); // the referee says there is no way; the router must agree
        continue;
      }
      expect(got.ok).toBe(true);
      routed += 1;

      // the same quickest time (within rounding)
      expect(Math.abs(got.durationS - Math.round(expected))).toBeLessThanOrEqual(1);

      // a road route can't beat the crow flies, and shouldn't be absurdly longer than it
      const crow = distanceM(graph.lat[a], graph.lon[a], graph.lat[b], graph.lon[b]);
      expect(got.distanceM).toBeGreaterThanOrEqual(Math.floor(crow) - 1);
      if (crow > 300) expect(got.distanceM).toBeLessThan(crow * 6);

      // the line is continuous and starts and ends where asked
      expect(got.geometry[0]).toEqual([graph.lat[a], graph.lon[a]]);
      expect(got.geometry[got.geometry.length - 1]).toEqual([graph.lat[b], graph.lon[b]]);
      for (let k = 1; k < got.geometry.length; k++) {
        const hop = distanceM(...got.geometry[k - 1], ...got.geometry[k]);
        expect(hop).toBeLessThanOrEqual(longestSegment + 1); // no teleporting between points
      }

      // directions: start, arrive, no junk text, distances add up
      expect(got.steps[0].text).toMatch(/^Head (north|north-east|east|south-east|south|south-west|west|north-west) on /);
      expect(got.steps[got.steps.length - 1].text).toBe("You have arrived");
      for (const s of got.steps) expect(s.text).not.toMatch(/undefined|null|NaN|\bonto\s*$/);
      // no stutter: the same instruction twice in a row (the bug that made directions unreadable)
      for (let k = 1; k < got.steps.length; k++) {
        expect(got.steps[k].text).not.toBe(got.steps[k - 1].text);
      }
      // and no step is a stub: apart from the first and last, each is a real stretch of road
      for (let k = 1; k < got.steps.length - 2; k++) expect(got.steps[k].distanceM).toBeGreaterThanOrEqual(14);
      const sum = got.steps.reduce((t, s) => t + s.distanceM, 0);
      expect(Math.abs(sum - got.distanceM)).toBeLessThanOrEqual(got.steps.length);
    }
    expect(routed).toBeGreaterThan(30);
  });

  test("walking is symmetric: A to B is as long as B to A", () => {
    if (mode !== "walk") return;
    for (let t = 0; t < 10; t++) {
      const a = nodes[Math.floor(rand() * nodes.length)];
      const b = nodes[Math.floor(rand() * nodes.length)];
      if (a === b) continue;
      const ab = route(graph, at(a), at(b), { mode });
      const ba = route(graph, at(b), at(a), { mode });
      expect(ab.distanceM).toBe(ba.distanceM);
    }
  });
});

describe("real places", () => {
  // Grambling State University campus and the I-20 / LA 3 area, from the middle of the pack
  const campus = { latitude: 32.5266, longitude: -92.7165 };
  const northEast = { latitude: 32.5405, longitude: -92.6975 };
  const southWest = { latitude: 32.5095, longitude: -92.7395 };

  test("campus to the north-east edge, on foot and by car", () => {
    const walk = route(graph, campus, northEast, { mode: "walk" });
    const drive = route(graph, campus, northEast, { mode: "drive" });
    expect(walk.ok && drive.ok).toBe(true);
    const crow = distanceM(campus.latitude, campus.longitude, northEast.latitude, northEast.longitude);
    expect(walk.distanceM).toBeGreaterThan(crow * 0.99);
    expect(drive.durationS).toBeLessThan(walk.durationS);
    expect(walk.durationS).toBeGreaterThan(walk.distanceM / 1.5);
  });
  test("a trip across the whole pack finishes fast", () => {
    const t0 = Date.now();
    const r = route(graph, southWest, northEast, { mode: "walk" });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.ok).toBe(true);
  });
  test("somewhere that is not in the pack is refused", () => {
    expect(route(graph, campus, { latitude: 32.7767, longitude: -96.797 }, { mode: "walk" })).toMatchObject({
      ok: false, reason: "outside_pack",
    });
  });
});
