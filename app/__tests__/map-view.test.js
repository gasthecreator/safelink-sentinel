import { projector, pickRoads, scaleBar, formatDistance, formatDuration } from "../services/navigation/mapView.js";
import { loadPack } from "../services/navigation/pack.js";
import { getPack, findPackFor, listPacks, setInstalledSource } from "../services/navigation/packs.js";

const { makePack, gridPack } = require("./helpers/packs.js");
const P = (latitude, longitude) => ({ latitude, longitude });

describe("projector", () => {
  const frame = { width: 300, height: 200, pad: 20 };
  const a = P(32.52, -92.72);
  const b = P(32.53, -92.70);

  test("north is up and east is right", () => {
    const { project } = projector([a, b], frame);
    expect(project(b.latitude, a.longitude).y).toBeLessThan(project(a.latitude, a.longitude).y);
    expect(project(a.latitude, b.longitude).x).toBeGreaterThan(project(a.latitude, a.longitude).x);
  });
  test("all the points fit inside the padded frame", () => {
    const { project } = projector([a, b], frame);
    for (const p of [a, b]) {
      const { x, y } = project(p.latitude, p.longitude);
      expect(x).toBeGreaterThanOrEqual(frame.pad - 0.5);
      expect(x).toBeLessThanOrEqual(frame.width - frame.pad + 0.5);
      expect(y).toBeGreaterThanOrEqual(frame.pad - 0.5);
      expect(y).toBeLessThanOrEqual(frame.height - frame.pad + 0.5);
    }
  });
  test("distances are in proportion in both directions (no stretching)", () => {
    const { project, metersPerPixel } = projector([a, b], frame);
    const o = project(a.latitude, a.longitude);
    const north = project(a.latitude + 0.001, a.longitude);
    const east = project(a.latitude, a.longitude + 0.001);
    const metresNorth = Math.abs(north.y - o.y) * metersPerPixel;
    const metresEast = Math.abs(east.x - o.x) * metersPerPixel;
    expect(metresNorth).toBeGreaterThan(109);
    expect(metresNorth).toBeLessThan(113);
    expect(metresEast).toBeGreaterThan(92); // 0.001 degrees of longitude at 32.5 N is ~94 m
    expect(metresEast).toBeLessThan(96);
  });
  test("zooming in shows less ground per pixel", () => {
    expect(projector([a, b], { ...frame, zoom: 2 }).metersPerPixel).toBeCloseTo(projector([a, b], frame).metersPerPixel / 2, 6);
  });
  test("one point, or none, does not blow up", () => {
    const one = projector([a], frame);
    expect(one.project(a.latitude, a.longitude)).toEqual({ x: 150, y: 100 });
    expect(Number.isFinite(one.metersPerPixel) && one.metersPerPixel > 0).toBe(true);
    expect(projector([], frame).bounds).toBeNull();
    expect(projector([P(NaN, 1), null, undefined], frame).bounds).toBeNull();
  });
  test("two almost-identical points are not zoomed in absurdly far", () => {
    const { metersPerPixel } = projector([a, P(a.latitude + 1e-7, a.longitude)], frame);
    expect(metersPerPixel * (frame.width - 2 * frame.pad)).toBeGreaterThanOrEqual(59);
  });
  test("the visible bounds contain the points", () => {
    const { bounds } = projector([a, b], frame);
    expect(bounds.south).toBeLessThanOrEqual(a.latitude);
    expect(bounds.north).toBeGreaterThanOrEqual(b.latitude);
    expect(bounds.west).toBeLessThanOrEqual(a.longitude);
    expect(bounds.east).toBeGreaterThanOrEqual(b.longitude);
  });
});

describe("pickRoads", () => {
  const { graph } = loadPack(makePack(gridPack(20, 20)));
  const all = { south: 0, north: 90, west: -180, east: 0 };
  test("only roads in view are returned", () => {
    expect(pickRoads(graph, all, 100000)).toHaveLength(graph.edgeCount);
    const far = { south: 10, north: 11, west: 10, east: 11 };
    expect(pickRoads(graph, far)).toHaveLength(0);
    const corner = { south: 32.52 - 0.0001, north: 32.52 + 0.0001, west: -92.72 - 0.0001, east: -92.72 + 0.0001 };
    const some = pickRoads(graph, corner, 100000);
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(10);
  });
  test("no bounds, no roads", () => {
    expect(pickRoads(graph, null)).toEqual([]);
  });
  test("too many roads: the limit is respected and major roads are kept first", () => {
    const pack = makePack({
      nodes: Array.from({ length: 60 }, (_, i) => [32.5 + i * 0.0001, -92.7]),
      edges: Array.from({ length: 59 }, (_, i) => ({ a: i, b: i + 1, cls: i % 10 === 0 ? "primary" : "residential", name: "x" })),
    });
    const g = loadPack(pack).graph;
    const picked = pickRoads(g, all, 20);
    expect(picked).toHaveLength(20);
    expect(picked.filter((r) => r.major)).toHaveLength(6); // every primary segment survived
  });
});

describe("scale bar and formatting", () => {
  test("a round-number bar that fits", () => {
    for (const mpp of [0.2, 0.5, 1, 3, 10, 40]) {
      const bar = scaleBar(mpp);
      expect(bar.pixels).toBeLessThanOrEqual(110);
      expect(bar.pixels).toBeGreaterThan(0);
      expect(bar.label).toMatch(/^\d+(\.\d+)? (m|km)$/);
    }
    expect(scaleBar(1).label).toBe("100 m");
    expect(scaleBar(10).label).toBe("1 km");
  });
  test("distances read naturally", () => {
    expect(formatDistance(4)).toBe("4 m");
    expect(formatDistance(253)).toBe("250 m");
    expect(formatDistance(999)).toBe("1000 m");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(25000)).toBe("25 km");
  });
  test("durations read naturally", () => {
    expect(formatDuration(20)).toBe("under a minute");
    expect(formatDuration(5 * 60)).toBe("5 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3600 + 25 * 60)).toBe("1 h 25 min");
  });
});

describe("packs on the phone", () => {
  beforeAll(() => setInstalledSource({ installed: async () => [], read: async () => null }));
  test("the bundled sample loads and is listed", async () => {
    expect((await getPack("grambling-la")).ok).toBe(true);
    expect(await getPack("grambling-la")).toBe(await getPack("grambling-la")); // cached, not re-parsed
    expect(await listPacks()).toEqual([expect.objectContaining({ id: "grambling-la", name: "Grambling, LA (sample)" })]);
  });
  test("an unknown pack is refused politely", async () => {
    expect(await getPack("atlantis")).toMatchObject({ ok: false });
  });
  test("a trip inside the area finds the pack; one outside does not", async () => {
    const inside = [P(32.5266, -92.7165), P(32.5405, -92.6975)];
    expect((await findPackFor(inside)).pack.name).toBe("Grambling, LA (sample)");
    const split = await findPackFor([P(32.5266, -92.7165), P(32.78, -96.8)]);
    expect(split.pack).toBeNull();
    expect(split.partial.name).toBe("Grambling, LA (sample)"); // so the screen can say only one end is covered
    expect(await findPackFor([P(32.78, -96.8), P(33, -97)])).toEqual({ pack: null, partial: null });
  });
});
