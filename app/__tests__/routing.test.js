import { loadPack } from "../services/navigation/pack.js";
import { createRouter, route, distanceM, bearingDeg, compassName } from "../services/navigation/router.js";

const { makePack, gridPack, WALK, DRIVE, ONEWAY } = require("./helpers/packs.js");

const pt = (latitude, longitude) => ({ latitude, longitude });
const make = (spec) => {
  const r = createRouter(makePack(spec));
  expect(r.ok).toBe(true);
  return r;
};

describe("geometry helpers", () => {
  test("distance and bearing", () => {
    expect(Math.round(distanceM(0, 0, 0, 1))).toBe(111195); // one degree of longitude at the equator
    expect(distanceM(30, -90, 30, -90)).toBe(0);
    expect(Math.round(bearingDeg(0, 0, 1, 0))).toBe(0);
    expect(Math.round(bearingDeg(0, 0, 0, 1))).toBe(90);
    expect(Math.round(bearingDeg(1, 0, 0, 0))).toBe(180);
    expect(Math.round(bearingDeg(0, 1, 0, 0))).toBe(270);
    expect(compassName(0)).toBe("north");
    expect(compassName(100)).toBe("east");
    expect(compassName(359)).toBe("north");
  });
});

describe("loading a pack refuses anything malformed", () => {
  const good = () => makePack({ nodes: [[30, -90], [30.001, -90]], edges: [{ a: 0, b: 1, name: "A St" }] });
  test("a good pack loads", () => {
    const r = loadPack(good());
    expect(r.ok).toBe(true);
    expect(r.graph).toMatchObject({ nodeCount: 2, edgeCount: 1, name: "Test pack" });
  });
  test.each([
    ["null", () => null],
    ["not an object", () => "pack"],
    ["wrong format", () => ({ ...good(), format: 2 })],
    ["odd node array", () => ({ ...good(), nodes: [1, 2, 3] })],
    ["no nodes", () => ({ ...good(), nodes: [] })],
    ["no edges", () => ({ ...good(), edges: [] })],
    ["edge array not a multiple of 6", () => ({ ...good(), edges: [0, 1, 5] })],
    ["a road to a missing point", () => ({ ...good(), edges: [0, 9, 100, 0, 3, 0] })],
    ["a road from a point to itself", () => ({ ...good(), edges: [0, 0, 100, 0, 3, 0] })],
    ["negative point index", () => ({ ...good(), edges: [-1, 1, 100, 0, 3, 0] })],
    ["zero-length road", () => ({ ...good(), edges: [0, 1, 0, 0, 3, 0] })],
    ["fractional numbers", () => ({ ...good(), edges: [0, 1, 100.5, 0, 3, 0] })],
    ["bad class index", () => ({ ...good(), edges: [0, 1, 100, 5, 3, 0] })],
    ["bad name index", () => ({ ...good(), edges: [0, 1, 100, 0, 3, 7] })],
    ["bad flags", () => ({ ...good(), edges: [0, 1, 100, 0, 99, 0] })],
    ["a point off the planet", () => ({ ...good(), nodes: [95e6, 0, 0, 0] })],
    ["string coordinates", () => ({ ...good(), nodes: ["30", "-90", 0, 0] })],
    ["no area", () => ({ ...good(), bbox: undefined })],
    ["NaN in the area", () => ({ ...good(), bbox: [NaN, 0, 1, 1] })],
    ["name tables missing", () => ({ ...good(), names: undefined })],
  ])("refuses %s", (_name, build) => {
    const r = loadPack(build());
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
  });
  test("long text in a pack is capped, not trusted", () => {
    const p = good();
    p.name = "N".repeat(1000);
    p.names[1] = "S".repeat(1000);
    const { graph } = loadPack(p);
    expect(graph.name).toHaveLength(120);
    expect(graph.names[1]).toHaveLength(120);
  });
});

describe("basic routing", () => {
  // three points in a line, 0.001 degrees (~111 m) apart
  const line = () => make({
    nodes: [[30, -90], [30.001, -90], [30.002, -90]],
    edges: [{ a: 0, b: 1, name: "A St" }, { a: 1, b: 2, name: "A St" }],
  });

  test("distance, time and geometry", () => {
    const r = line().route(pt(30, -90), pt(30.002, -90));
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBeGreaterThan(220);
    expect(r.distanceM).toBeLessThan(224);
    expect(r.durationS).toBe(Math.round(r.distanceM / 1.4)); // walking pace
    expect(r.geometry).toHaveLength(3);
    expect(r.geometry[0]).toEqual([30, -90]);
    expect(r.mode).toBe("walk");
  });
  test("driving is quicker than walking over the same road", () => {
    const walk = line().route(pt(30, -90), pt(30.002, -90), { mode: "walk" });
    const drive = line().route(pt(30, -90), pt(30.002, -90), { mode: "drive" });
    expect(drive.durationS).toBeLessThan(walk.durationS);
    expect(drive.distanceM).toBe(walk.distanceM);
  });
  test("going the other way gives the same length", () => {
    const r = line();
    expect(r.route(pt(30.002, -90), pt(30, -90)).distanceM).toBe(r.route(pt(30, -90), pt(30.002, -90)).distanceM);
  });
  test("a start and end that snap to the same point is a trivial route, not a crash", () => {
    const r = line().route(pt(30.0001, -90), pt(30.00012, -90));
    expect(r.ok).toBe(true);
    expect(r.steps).toHaveLength(1);
  });
  test("it picks the quicker of two routes", () => {
    // square with a diagonal shortcut 0 -> 3
    const r = make({
      nodes: [[30, -90], [30, -89.999], [30.001, -89.999], [30.001, -90]],
      edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 0, b: 3, name: "Short Cut" }],
    });
    const out = r.route(pt(30, -90), pt(30.001, -90));
    expect(out.geometry).toHaveLength(2); // straight along the short edge
  });
});

describe("walkers and vehicles use different roads", () => {
  // 0 --footway-- 1 direct; and a longer residential road 0 - 2 - 1 around it
  const spec = () => ({
    nodes: [[30, -90], [30, -89.998], [30.002, -89.999]],
    edges: [
      { a: 0, b: 1, cls: "footway", name: "", flags: WALK },
      { a: 0, b: 2, cls: "residential", name: "Long Rd" },
      { a: 2, b: 1, cls: "residential", name: "Long Rd" },
    ],
  });
  test("a walker takes the footpath", () => {
    const r = make(spec()).route(pt(30, -90), pt(30, -89.998), { mode: "walk" });
    expect(r.geometry).toHaveLength(2);
    expect(r.steps[0].text).toMatch(/the footpath/);
  });
  test("a car cannot, and goes round", () => {
    const r = make(spec()).route(pt(30, -90), pt(30, -89.998), { mode: "drive" });
    expect(r.geometry).toHaveLength(3);
    expect(r.steps[0].text).toMatch(/Long Road/);
  });
  test("a motorway is for cars, not walkers", () => {
    const r = make({
      nodes: [[30, -90], [30, -89.999], [30, -89.998]],
      edges: [
        { a: 0, b: 1, cls: "motorway", name: "I-20", flags: DRIVE },
        { a: 1, b: 2, cls: "motorway", name: "I-20", flags: DRIVE },
      ],
    });
    expect(r.route(pt(30, -90), pt(30, -89.998), { mode: "walk" }).ok).toBe(false);
    expect(r.route(pt(30, -90), pt(30, -89.998), { mode: "drive" }).ok).toBe(true);
  });
});

describe("one-way streets", () => {
  // a -> b is one-way; the only other connection is the long way round via c
  const spec = () => ({
    nodes: [[30, -90], [30, -89.999], [30.001, -89.9995]],
    edges: [
      { a: 0, b: 1, name: "One Way St", flags: WALK | DRIVE | ONEWAY },
      { a: 1, b: 2, name: "Back Rd" },
      { a: 2, b: 0, name: "Back Rd" },
    ],
  });
  test("a car may go the permitted way directly", () => {
    const r = make(spec()).route(pt(30, -90), pt(30, -89.999), { mode: "drive" });
    expect(r.geometry).toHaveLength(2);
  });
  test("a car may not go against it, and takes the long way", () => {
    const r = make(spec()).route(pt(30, -89.999), pt(30, -90), { mode: "drive" });
    expect(r.ok).toBe(true);
    expect(r.geometry).toHaveLength(3);
    expect(r.steps.map((s) => s.text).join(" ")).not.toMatch(/One Way Street/);
  });
  test("a walker ignores one-way signs", () => {
    const r = make(spec()).route(pt(30, -89.999), pt(30, -90), { mode: "walk" });
    expect(r.geometry).toHaveLength(2);
  });
  test("with no legal way, driving says so and suggests walking", () => {
    // u <-> w two-way, w -> v one-way, v <-> x two-way: you can drive u to v but never back
    const r = make({
      nodes: [[30, -90], [30, -89.999], [30, -89.998], [30, -89.997]],
      edges: [
        { a: 0, b: 1, name: "West Rd" },
        { a: 1, b: 2, name: "One Way St", flags: WALK | DRIVE | ONEWAY },
        { a: 2, b: 3, name: "East Rd" },
      ],
    });
    const there = r.route(pt(30, -90), pt(30, -89.998), { mode: "drive" });
    expect(there.ok).toBe(true);
    const back = r.route(pt(30, -89.998), pt(30, -90), { mode: "drive" });
    expect(back).toMatchObject({ ok: false, reason: "no_route" });
    expect(back.message).toMatch(/walking/);
    expect(r.route(pt(30, -89.998), pt(30, -90), { mode: "walk" }).ok).toBe(true); // a walker can
  });
  test("a point that is only the start or end of a one-way street is not used as a place to start or finish", () => {
    const r = make({
      nodes: [[30, -90], [30, -89.999]],
      edges: [{ a: 0, b: 1, name: "One Way St", flags: WALK | DRIVE | ONEWAY }],
    });
    expect(r.route(pt(30, -89.999), pt(30, -90), { mode: "drive" })).toMatchObject({ ok: false, reason: "no_road_near" });
  });
});

describe("disconnected roads", () => {
  // a main road of 60 points, and a separate 3-point fragment close to the start
  const spec = () => {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 60; i++) nodes.push([30, -90 + i * 0.0005]);
    for (let i = 0; i < 59; i++) edges.push({ a: i, b: i + 1, name: "Main St" });
    const f = nodes.length;
    nodes.push([30.0002, -90], [30.0002, -89.9995], [30.0002, -89.999]);
    edges.push({ a: f, b: f + 1, name: "Car Park" }, { a: f + 1, b: f + 2, name: "Car Park" });
    return { nodes, edges, bbox: [29.99, -90.01, 30.01, -89.96] };
  };
  test("it starts from the main network, not a tiny fragment that happens to be nearer", () => {
    const r = make(spec()).route(pt(30.0002, -90), pt(30, -89.98));
    expect(r.ok).toBe(true);
    expect(r.steps[0].text).toMatch(/Main Street/);
  });
  test("two separate networks give a clear 'no route', not a hang", () => {
    // 100 points main + a 60-point second network, both big enough to count
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 60; i++) nodes.push([30, -90 + i * 0.0005]);
    for (let i = 0; i < 59; i++) edges.push({ a: i, b: i + 1, name: "West Rd" });
    for (let i = 0; i < 60; i++) nodes.push([30.01, -90 + i * 0.0005]);
    for (let i = 60; i < 119; i++) edges.push({ a: i, b: i + 1, name: "North Rd" });
    const r = make({ nodes, edges, bbox: [29.99, -90.01, 30.02, -89.96] }).route(pt(30, -89.99), pt(30.01, -89.99));
    expect(r).toMatchObject({ ok: false, reason: "no_route" });
  });
});

describe("bad input and coverage", () => {
  const r = () => make({
    nodes: [[30, -90], [30.001, -90]],
    edges: [{ a: 0, b: 1, name: "A St" }],
    bbox: [29.999, -90.001, 30.002, -89.999],
  });
  test("outside the map is reported for the right end", () => {
    expect(r().route(pt(40, -80), pt(30.001, -90))).toMatchObject({ ok: false, reason: "outside_pack" });
    expect(r().route(pt(30, -90), pt(40, -80)).message).toMatch(/Their position/);
    expect(r().route(pt(40, -80), pt(30, -90)).message).toMatch(/Your position/);
  });
  test.each([
    [null, pt(30, -90)],
    [pt(30, -90), undefined],
    [pt(NaN, -90), pt(30, -90)],
    [pt(30, -90), pt(91, 0)],
    [{ latitude: "30", longitude: "-90" }, pt(30, -90)],
  ])("invalid positions are refused (%j, %j)", (a, b) => {
    expect(r().route(a, b)).toMatchObject({ ok: false, reason: "bad_input" });
  });
  test("a position far from any road still routes, with a warning", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90]],
      edges: [{ a: 0, b: 1, name: "A St" }],
      bbox: [29.99, -90.01, 30.01, -89.99],
    }).route(pt(30.004, -89.995), pt(30.001, -90));
    expect(out.ok).toBe(true);
    expect(out.warnings.join(" ")).toMatch(/nearest known road to you/);
    expect(out.start.offM).toBeGreaterThan(150);
  });
});

describe("turn-by-turn directions", () => {
  // grid: node id = r * 4 + c, rows run east-west ("Row n Street"), columns north-south
  const grid = () => make(gridPack(4, 4, { name: (dir, i) => `${dir === "Row" ? "East" : "North"} ${i} Ave` }));
  const id = (r, c) => ({ latitude: 32.52 + r * 0.0009, longitude: -92.72 + c * 0.0009 });

  test("a straight run is one step plus arrival", () => {
    const out = grid().route(id(0, 0), id(0, 3));
    expect(out.steps.map((s) => s.text)).toEqual(["Head east on East 0 Avenue", "You have arrived"]);
    expect(out.steps[0].distanceM).toBeGreaterThan(240); // 3 blocks of ~84 m
  });
  test("an L-shaped route gives a head, a turn and an arrival", () => {
    const out = grid().route(id(0, 0), id(3, 3));
    const texts = out.steps.map((s) => s.text);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/^Head (north|east)/);
    expect(texts[1]).toMatch(/^Turn (left|right) onto/);
    expect(texts[2]).toBe("You have arrived");
  });
  test("left and right are the right way round", () => {
    // heading east then north is a LEFT turn; heading north then east is a RIGHT turn
    const eastThenNorth = make({
      nodes: [[30, -90], [30, -89.999], [30.001, -89.999]],
      edges: [{ a: 0, b: 1, name: "East St" }, { a: 1, b: 2, name: "North St" }],
    }).route(pt(30, -90), pt(30.001, -89.999));
    expect(eastThenNorth.steps[1].text).toBe("Turn left onto North Street");
    const northThenEast = make({
      nodes: [[30, -90], [30.001, -90], [30.001, -89.999]],
      edges: [{ a: 0, b: 1, name: "North St" }, { a: 1, b: 2, name: "East St" }],
    }).route(pt(30, -90), pt(30.001, -89.999));
    expect(northThenEast.steps[1].text).toBe("Turn right onto East Street");
  });
  test("a gentle bend is 'bear', and a name change on a straight road is 'continue'", () => {
    const bear = make({
      nodes: [[30, -90], [30.001, -90], [30.002, -89.9992]],
      edges: [{ a: 0, b: 1, name: "A St" }, { a: 1, b: 2, name: "B St" }],
    }).route(pt(30, -90), pt(30.002, -89.9992));
    expect(bear.steps[1].text).toMatch(/^Bear right onto B Street/);
    const cont = make({
      nodes: [[30, -90], [30.001, -90], [30.002, -90]],
      edges: [{ a: 0, b: 1, name: "A St" }, { a: 1, b: 2, name: "B St" }],
    }).route(pt(30, -90), pt(30.002, -90));
    expect(cont.steps[1].text).toBe("Continue onto B Street");
  });
  test("a sharp reversal is called out", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90], [30.0005, -89.99995]],
      edges: [{ a: 0, b: 1, name: "A St" }, { a: 1, b: 2, name: "Back St" }],
    }).route(pt(30, -90), pt(30.0005, -89.99995));
    expect(out.steps[1].text).toMatch(/sharp|U-turn/);
  });
  test("unnamed roads are described by kind, never as 'undefined' or blank", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90], [30.001, -89.999]],
      edges: [{ a: 0, b: 1, cls: "footway", name: "", flags: WALK }, { a: 1, b: 2, cls: "steps", name: "", flags: WALK }],
    }).route(pt(30, -90), pt(30.001, -89.999));
    expect(out.steps[0].text).toBe("Head north on the footpath");
    expect(out.steps[1].text).toMatch(/onto the steps$/);
    for (const s of out.steps) expect(s.text).not.toMatch(/undefined|null|NaN/);
  });
  test("step distances add up to the route, and each step has a position", () => {
    const out = grid().route(id(0, 0), id(3, 2));
    const sum = out.steps.reduce((t, s) => t + s.distanceM, 0);
    expect(Math.abs(sum - out.distanceM)).toBeLessThanOrEqual(out.steps.length); // rounding only
    for (const s of out.steps) {
      expect(Number.isFinite(s.lat) && Number.isFinite(s.lon)).toBe(true);
    }
  });
  test("a bend in the same street, with nothing branching off, is not a step", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90], [30.001, -89.999]],
      edges: [{ a: 0, b: 1, name: "Main St" }, { a: 1, b: 2, name: "Main St" }],
    }).route(pt(30, -90), pt(30.001, -89.999));
    expect(out.steps.map((s) => s.text)).toEqual(["Head north on Main Street", "You have arrived"]);
    expect(out.steps[0].distanceM).toBe(out.distanceM);
  });
  test("a turn at a junction on the same street says 'Turn right', not 'onto' the street you are already on", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90], [30.001, -89.999], [30.0015, -90]],
      edges: [
        { a: 0, b: 1, name: "Main St" },
        { a: 1, b: 2, name: "Main St" },
        { a: 1, b: 3, name: "Side St" }, // makes node 1 a junction
      ],
    }).route(pt(30, -90), pt(30.001, -89.999));
    expect(out.steps.map((s) => s.text)).toEqual(["Head north on Main Street", "Turn right", "You have arrived"]);
  });
  test("a quick dogleg is folded away instead of becoming two odd steps", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90], [30.001, -89.99991], [30.002, -89.99991]],
      edges: [
        { a: 0, b: 1, name: "A St" },
        { a: 1, b: 2, name: "Jog Way" }, // ~8 m sideways
        { a: 2, b: 3, name: "A St" },
      ],
    }).route(pt(30, -90), pt(30.002, -89.99991));
    expect(out.steps.map((s) => s.text)).toEqual(["Head north on A Street", "You have arrived"]);
  });
  test("a real junction on a different street is still a step even if short legs surround it", () => {
    const out = make({
      nodes: [[30, -90], [30.001, -90], [30.001, -89.999], [30.001, -89.998]],
      edges: [{ a: 0, b: 1, name: "A St" }, { a: 1, b: 2, name: "B St" }, { a: 2, b: 3, name: "B St" }],
    }).route(pt(30, -90), pt(30.001, -89.998));
    expect(out.steps.map((s) => s.text)).toEqual(["Head north on A Street", "Turn right onto B Street", "You have arrived"]);
  });
  test("steps are slower to walk than a flat road", () => {
    const flat = make({ nodes: [[30, -90], [30.001, -90]], edges: [{ a: 0, b: 1, cls: "footway", flags: WALK }] })
      .route(pt(30, -90), pt(30.001, -90));
    const steps = make({ nodes: [[30, -90], [30.001, -90]], edges: [{ a: 0, b: 1, cls: "steps", flags: WALK }] })
      .route(pt(30, -90), pt(30.001, -90));
    expect(steps.durationS).toBeGreaterThan(flat.durationS);
  });
});

describe("scale", () => {
  test("a 150 x 150 street grid (22,500 points) routes corner to corner quickly", () => {
    const r = make(gridPack(150, 150));
    const t0 = Date.now();
    const out = r.route(pt(32.52, -92.72), pt(32.52 + 149 * 0.0009, -92.72 + 149 * 0.0009));
    const ms = Date.now() - t0;
    expect(out.ok).toBe(true);
    expect(out.distanceM).toBeGreaterThan(26000); // 298 blocks of ~90-100 m
    expect(ms).toBeLessThan(1500);
  });
});
