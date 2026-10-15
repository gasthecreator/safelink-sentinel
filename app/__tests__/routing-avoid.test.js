import { createRouter, route, distanceM } from "../services/navigation/router.js";
import { loadPack } from "../services/navigation/pack.js";

const { makePack, gridPack } = require("./helpers/packs.js");

const pt = (latitude, longitude) => ({ latitude, longitude });
const STEP = 0.0009; // grid spacing in degrees: ~100 m north-south, ~84 m east-west
const node = (r, c) => pt(32.52 + r * STEP, -92.72 + c * STEP);
const closure = (p, over = {}) => ({ kind: "blocked", latitude: p.latitude, longitude: p.longitude, radiusM: 40, reportedAt: 0, reporters: 1, disputed: false, note: null, ...over });
const grid = (rows = 5, cols = 7) => {
  const r = createRouter(makePack(gridPack(rows, cols)));
  expect(r.ok).toBe(true);
  return r;
};

// the point halfway along a route's line
const midpoint = (geometry) => {
  const [la, lo] = geometry[Math.floor(geometry.length / 2)];
  return pt(la, lo);
};
// does any part of the route's line pass within `m` of this point (using the points it draws through)
const passesWithin = (geometry, p, m) =>
  geometry.some(([la, lo], i) => {
    if (distanceM(la, lo, p.latitude, p.longitude) <= m) return true;
    if (i === 0) return false;
    const [pa, po] = geometry[i - 1];
    return distanceM((la + pa) / 2, (lo + po) / 2, p.latitude, p.longitude) <= m;
  });

describe("detouring around a reported closure", () => {
  test("a closure on the quickest route makes the route go round it", () => {
    const r = grid();
    const from = node(0, 0);
    const to = node(0, 6);
    const plain = r.route(from, to); // straight along the bottom street
    const block = midpoint(plain.geometry);
    const detour = r.route(from, to, { avoid: [closure(block)] });

    expect(detour.ok).toBe(true);
    expect(passesWithin(detour.geometry, block, 40)).toBe(false); // really avoids the spot
    expect(passesWithin(plain.geometry, block, 40)).toBe(true); // and the plain one really did go through it
    expect(detour.distanceM).toBeGreaterThan(plain.distanceM);
    expect(detour.detour).toMatchObject({ extraM: expect.any(Number) });
    expect(detour.detour.extraM).toBeGreaterThan(0);
    expect(detour.detour.closures).toHaveLength(1);
  });
  test("a closure nowhere near the route changes nothing", () => {
    const r = grid();
    const plain = r.route(node(0, 0), node(0, 6));
    const far = r.route(node(0, 0), node(0, 6), { avoid: [closure(node(4, 3))] });
    expect(far.distanceM).toBe(plain.distanceM);
    expect(far.geometry).toEqual(plain.geometry);
    expect(far.detour).toBeNull();
  });
  test("several closures are all avoided", () => {
    const r = grid(6, 8);
    const plain = r.route(node(0, 0), node(0, 7));
    const blocks = [node(0, 2), node(0, 5)].map((p) => closure(p));
    const out = r.route(node(0, 0), node(0, 7), { avoid: blocks });
    expect(out.ok).toBe(true);
    for (const b of blocks) expect(passesWithin(out.geometry, b, 40)).toBe(false);
    expect(out.detour.closures).toHaveLength(2);
    expect(out.distanceM).toBeGreaterThan(plain.distanceM);
  });
  test("it works for cars as well as walkers", () => {
    const r = grid();
    const block = closure(node(0, 3));
    const out = r.route(node(0, 0), node(0, 6), { mode: "drive", avoid: [block] });
    expect(out.ok).toBe(true);
    expect(passesWithin(out.geometry, block, 40)).toBe(false);
  });
  test("the route is still the quickest one that avoids the closure", () => {
    const r = grid();
    const out = r.route(node(0, 0), node(0, 6), { avoid: [closure(node(0, 3))] });
    // the shortest way round a one-block hole on a grid is two blocks extra at most
    const plain = r.route(node(0, 0), node(0, 6));
    expect(out.distanceM).toBeLessThan(plain.distanceM + 260);
  });
});

describe("when closures cut everything off", () => {
  // a single road with a closure in the middle: no way round
  const single = () => {
    const nodes = [];
    for (let i = 0; i < 40; i++) nodes.push([32.52, -92.72 + i * 0.0003]);
    const edges = [];
    for (let i = 0; i < 39; i++) edges.push({ a: i, b: i + 1, name: "Only Road" });
    return createRouter(makePack({ nodes, edges }));
  };
  test("it says so, rather than quietly driving you through the closure", () => {
    const r = single();
    const from = pt(32.52, -92.72 + 0.0003 * 5);
    const to = pt(32.52, -92.72 + 0.0003 * 35);
    expect(r.route(from, to).ok).toBe(true);
    const out = r.route(from, to, { avoid: [closure(pt(32.52, -92.72 + 0.0003 * 20))] });
    expect(out).toMatchObject({ ok: false, reason: "blocked_by_reports" });
    expect(out.message).toMatch(/can be wrong/);
  });
  test("and without the reports the same trip still works (the 'show it anyway' choice)", () => {
    const r = single();
    expect(r.route(pt(32.52, -92.72 + 0.0003 * 5), pt(32.52, -92.72 + 0.0003 * 35), { avoid: [] }).ok).toBe(true);
  });
  test("a closure at the destination does not make the trip impossible, it warns", () => {
    const r = single();
    const to = pt(32.52, -92.72 + 0.0003 * 35);
    const out = r.route(pt(32.52, -92.72 + 0.0003 * 5), to, { avoid: [closure(to)] });
    expect(out.ok).toBe(true);
    expect(out.warnings.join(" ")).toMatch(/closure is reported right at/);
  });
  test("a closure at the start does not trap you there, it warns", () => {
    const r = single();
    const from = pt(32.52, -92.72 + 0.0003 * 5);
    const out = r.route(from, pt(32.52, -92.72 + 0.0003 * 35), { avoid: [closure(from)] });
    expect(out.ok).toBe(true);
    expect(out.warnings.join(" ")).toMatch(/closure is reported right at/);
  });
});

describe("hazards and bad input", () => {
  test("a hazard on the route is listed, not routed around", () => {
    const r = grid();
    const plain = r.route(node(0, 0), node(0, 6));
    const haz = { ...closure(midpoint(plain.geometry)), kind: "hazard", note: "flooding" };
    const out = r.route(node(0, 0), node(0, 6), { avoid: [haz] });
    expect(out.geometry).toEqual(plain.geometry); // same route
    expect(out.hazardsOnRoute).toEqual([expect.objectContaining({ note: "flooding" })]);
    expect(out.detour).toBeNull();
  });
  test("a hazard away from the route is not mentioned", () => {
    const r = grid();
    const haz = { ...closure(node(4, 3)), kind: "hazard" };
    expect(r.route(node(0, 0), node(0, 6), { avoid: [haz] }).hazardsOnRoute).toEqual([]);
  });
  test("invalid closures are ignored rather than crashing or blocking everything", () => {
    const r = grid();
    const plain = r.route(node(0, 0), node(0, 6));
    const junk = [null, undefined, {}, { kind: "blocked" }, closure(pt(NaN, 0)), closure(node(0, 3), { radiusM: 0 }),
      closure(node(0, 3), { radiusM: -5 }), { ...closure(node(0, 3)), kind: "passable" }, 7, "x"];
    const out = r.route(node(0, 0), node(0, 6), { avoid: junk });
    expect(out.ok).toBe(true);
    expect(out.geometry).toEqual(plain.geometry);
  });
  test("with no avoid list nothing changes", () => {
    const r = grid();
    expect(r.route(node(0, 0), node(0, 6)).detour).toBeNull();
    expect(r.route(node(0, 0), node(0, 6), { avoid: undefined }).ok).toBe(true);
  });
});

describe("on the real Grambling roads", () => {
  const { graph } = loadPack(require("../assets/maps/grambling-la.json"));
  const campus = pt(32.5266, -92.7165);
  const edge = pt(32.5405, -92.6975);

  test("blocking the middle of a real route sends it a different way", () => {
    const plain = route(graph, campus, edge, { mode: "walk" });
    expect(plain.ok).toBe(true);
    const block = midpoint(plain.geometry);
    const out = route(graph, campus, edge, { mode: "walk", avoid: [closure(block)] });
    if (out.ok) {
      expect(passesWithin(out.geometry, block, 40)).toBe(false);
      expect(out.distanceM).toBeGreaterThanOrEqual(plain.distanceM);
      expect(out.detour).not.toBeNull();
    } else {
      expect(out.reason).toBe("blocked_by_reports"); // an honest answer if it really is the only way
    }
  });
  test("a closure on a different part of town does not disturb it", () => {
    const plain = route(graph, campus, edge, { mode: "walk" });
    const out = route(graph, campus, edge, { mode: "walk", avoid: [closure(pt(32.5105, -92.7385))] });
    if (!passesWithin(plain.geometry, pt(32.5105, -92.7385), 60)) expect(out.geometry).toEqual(plain.geometry);
  });
  test("many closures at once is still fast", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => closure(pt(32.51 + (i % 8) * 0.004, -92.74 + Math.floor(i / 8) * 0.008)));
    const t0 = Date.now();
    route(graph, campus, edge, { mode: "walk", avoid: blocks });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
