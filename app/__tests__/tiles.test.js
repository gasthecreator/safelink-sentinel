const { splitBbox, mergeOverpass, MAX_TILE_AREA } = require("../scripts/lib/tiles");
const { osmToPack } = require("../scripts/lib/osmToPack");

const area = ([s, w, n, e]) => (n - s) * (e - w);

describe("splitBbox", () => {
  test.each([
    [[32.4, -92.95, 32.65, -92.45]],
    [[0, 0, 0.1, 0.1]],
    [[10, 10, 10.01, 10.5]],      // long and thin
    [[32.505, -92.745, 32.545, -92.69]], // small: one tile
    [[-33.9, 151.0, -33.6, 151.4]],
  ])("tiles %j cover it exactly, with no gaps or overlaps, and none too big", (bbox) => {
    const tiles = splitBbox(bbox);
    const [s, w, n, e] = bbox;
    for (const t of tiles) expect(area(t)).toBeLessThanOrEqual(MAX_TILE_AREA + 1e-12);
    expect(tiles.reduce((t, x) => t + area(x), 0)).toBeCloseTo(area(bbox), 9);
    expect(Math.min(...tiles.map((t) => t[0]))).toBe(s);
    expect(Math.min(...tiles.map((t) => t[1]))).toBe(w);
    expect(Math.max(...tiles.map((t) => t[2]))).toBe(n);
    expect(Math.max(...tiles.map((t) => t[3]))).toBe(e);
    // neighbouring tiles meet exactly: every tile edge is shared with the grid, none float
    const norths = new Set(tiles.map((t) => t[0]));
    for (const t of tiles) if (t[2] !== n) expect(norths.has(t[2])).toBe(true);
    const easts = new Set(tiles.map((t) => t[1]));
    for (const t of tiles) if (t[3] !== e) expect(easts.has(t[3])).toBe(true);
  });
  test("a small area is a single tile", () => {
    expect(splitBbox([32.505, -92.745, 32.545, -92.69])).toHaveLength(1);
  });
});

// A made-up town: a street grid whose roads run well past any tile edge, as real roads do.
function town() {
  const elements = [];
  const N = 40;                        // 40 x 40 junctions, 0.005 degrees apart
  const id = (r, c) => 1 + r * N + c;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    elements.push({ type: "node", id: id(r, c), lat: 10 + r * 0.005, lon: 20 + c * 0.005 });
  }
  let wid = 1000;
  for (let r = 0; r < N; r += 2) { // a long road along each even row
    elements.push({ type: "way", id: wid++, nodes: Array.from({ length: N }, (_, c) => id(r, c)), tags: { highway: "residential", name: `Row ${r}` } });
  }
  for (let c = 0; c < N; c += 2) { // and down each even column
    elements.push({ type: "way", id: wid++, nodes: Array.from({ length: N }, (_, r) => id(r, c)), tags: { highway: "residential", name: `Col ${c}` } });
  }
  return elements;
}

// what Overpass returns for way[highway](bbox);(._;>;): every way touching the box, with all its nodes
function fakeOverpass(elements, [s, w, n, e]) {
  const nodes = new Map(elements.filter((x) => x.type === "node").map((x) => [x.id, x]));
  const ways = elements.filter((x) => x.type === "way").filter((way) =>
    way.nodes.some((i) => { const p = nodes.get(i); return p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e; }));
  const used = new Set(ways.flatMap((way) => way.nodes));
  return { elements: [...used].map((i) => nodes.get(i)), ways }.elements.concat(ways);
}

test("fetching in tiles and joining gives exactly the same pack as one big fetch", () => {
  const all = town();
  const bbox = [10.02, 20.02, 10.18, 20.18];
  const whole = osmToPack({ elements: fakeOverpass(all, bbox) }, { name: "t", bbox });
  const tiles = splitBbox(bbox, 0.004); // many small tiles
  expect(tiles.length).toBeGreaterThan(4);
  const merged = mergeOverpass(tiles.map((t) => ({ elements: fakeOverpass(all, t) })));
  const joined = osmToPack(merged, { name: "t", bbox });
  expect(joined.stats.nodes).toBe(whole.stats.nodes);
  expect(joined.stats.edges).toBe(whole.stats.edges);
  // same roads, same lengths (order may differ)
  const key = (p) => {
    const out = [];
    for (let i = 0; i < p.edges.length; i += 6) {
      const a = [p.nodes[p.edges[i] * 2], p.nodes[p.edges[i] * 2 + 1]].join();
      const b = [p.nodes[p.edges[i + 1] * 2], p.nodes[p.edges[i + 1] * 2 + 1]].join();
      out.push([a, b].sort().join("|") + ":" + p.edges[i + 2] + ":" + p.names[p.edges[i + 5]]);
    }
    return out.sort();
  };
  expect(key(joined)).toEqual(key(whole));
});

test("a road crossing tile edges is joined once, not duplicated", () => {
  const one = { type: "way", id: 7, nodes: [1, 2], tags: { highway: "residential" } };
  const a = { elements: [{ type: "node", id: 1, lat: 0, lon: 0 }, { type: "node", id: 2, lat: 0, lon: 1 }, one] };
  const b = { elements: [{ type: "node", id: 2, lat: 0, lon: 1 }, { type: "node", id: 1, lat: 0, lon: 0 }, one] };
  const merged = mergeOverpass([a, b]);
  expect(merged.elements.filter((x) => x.type === "way")).toHaveLength(1);
  expect(merged.elements.filter((x) => x.type === "node")).toHaveLength(2);
});
