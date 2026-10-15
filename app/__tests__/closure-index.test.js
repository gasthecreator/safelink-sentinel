// The road-closure lookup uses a spatial grid; it must find exactly the roads the plain scan finds.
import { loadPack } from "../services/navigation/pack.js";
import { route, __internals } from "../services/navigation/router.js";

const { blockedEdges, pointToSegmentM } = __internals;
const graph = loadPack(require("../assets/maps/grambling-la.json")).graph;
const M_PER_DEG_LAT = 111320;

// the original implementation, kept here as the referee
function scan(g, closures) {
  const blocked = new Uint8Array(g.edgeCount);
  const perClosure = closures.map(() => []);
  closures.forEach((c, ci) => {
    const dLat = c.radiusM / M_PER_DEG_LAT;
    const dLon = c.radiusM / (M_PER_DEG_LAT * Math.max(0.2, Math.cos((c.latitude * Math.PI) / 180)));
    for (let e = 0; e < g.edgeCount; e++) {
      const a = g.ea[e], b = g.eb[e];
      const la = g.lat[a], lo = g.lon[a], lb = g.lat[b], lob = g.lon[b];
      if (Math.max(la, lb) < c.latitude - dLat || Math.min(la, lb) > c.latitude + dLat) continue;
      if (Math.max(lo, lob) < c.longitude - dLon || Math.min(lo, lob) > c.longitude + dLon) continue;
      if (pointToSegmentM(c, [la, lo], [lb, lob]) <= c.radiusM) { blocked[e] = 1; perClosure[ci].push(e); }
    }
  });
  return { blocked, perClosure };
}

// deterministic pseudo-random closures over (and slightly beyond) the pack
function closures(n, radii) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const [s, w, no, e] = graph.bbox;
  return Array.from({ length: n }, (_, i) => ({
    kind: "blocked",
    latitude: s - 0.004 + rnd() * (no - s + 0.008),
    longitude: w - 0.004 + rnd() * (e - w + 0.008),
    radiusM: radii[i % radii.length],
  }));
}

test("grid lookup finds exactly the same roads as scanning every road", () => {
  const set = closures(300, [15, 40, 90, 400, 1500]);
  const fast = blockedEdges(graph, set);
  const slow = scan(graph, set);
  expect(Array.from(fast.blocked)).toEqual(Array.from(slow.blocked));
  expect(fast.perClosure).toEqual(slow.perClosure);
  expect(slow.perClosure.some((l) => l.length > 0)).toBe(true); // the comparison is not vacuous
});

test("a closure far outside the pack blocks nothing; one with a huge radius blocks everything", () => {
  const far = blockedEdges(graph, [{ latitude: 10, longitude: 10, radiusM: 100 }]);
  expect(far.perClosure[0]).toEqual([]);
  const all = blockedEdges(graph, [{ latitude: 32.53, longitude: -92.705, radiusM: 50000 }]);
  expect(all.perClosure[0].length).toBe(graph.edgeCount);
});

test("hundreds of closures no longer make routing slow", () => {
  const set = closures(500, [40]);
  const t = Date.now();
  route(graph, { latitude: 32.5266, longitude: -92.7165 }, { latitude: 32.5405, longitude: -92.6975 }, { mode: "walk", avoid: set });
  expect(Date.now() - t).toBeLessThan(500); // the plain scan took several times this on the larger pack
});
