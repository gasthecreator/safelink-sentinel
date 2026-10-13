// app/services/navigation/pack.js
// Loads an offline routing pack (see scripts/lib/osmToPack.js for the format) into
// typed arrays for fast routing. A pack may one day be downloaded, so it is validated
// before use: a corrupt or hostile file is refused, never trusted.

export const WALK = "walk";
export const DRIVE = "drive";
const FLAG_WALK = 1;
const FLAG_DRIVE = 2;
const FLAG_ONEWAY = 4;
const MAX_NODES = 3_000_000;
const MAX_EDGES = 6_000_000;

const isInt = (v) => Number.isInteger(v);

/** @returns {{ok: true, graph: object} | {ok: false, error: string}} */
export function loadPack(raw) {
  try {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Map pack is empty." };
    if (raw.format !== 1) return { ok: false, error: "This map pack is a newer or unknown version." };
    const { nodes, edges, names, classes, bbox } = raw;
    if (!Array.isArray(nodes) || nodes.length % 2 !== 0 || nodes.length === 0) return { ok: false, error: "Map pack has no points." };
    if (!Array.isArray(edges) || edges.length % 6 !== 0 || edges.length === 0) return { ok: false, error: "Map pack has no roads." };
    if (!Array.isArray(names) || !Array.isArray(classes)) return { ok: false, error: "Map pack is missing its name tables." };
    if (nodes.length / 2 > MAX_NODES || edges.length / 6 > MAX_EDGES) return { ok: false, error: "Map pack is too large." };
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      return { ok: false, error: "Map pack has no valid area." };
    }

    const n = nodes.length / 2;
    const lat = new Float64Array(n);
    const lon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const la = nodes[2 * i];
      const lo = nodes[2 * i + 1];
      if (!isInt(la) || !isInt(lo) || Math.abs(la) > 90e6 || Math.abs(lo) > 180e6) {
        return { ok: false, error: "Map pack has an invalid point." };
      }
      lat[i] = la / 1e6;
      lon[i] = lo / 1e6;
    }

    const m = edges.length / 6;
    const ea = new Int32Array(m);
    const eb = new Int32Array(m);
    const len = new Float32Array(m);
    const cls = new Uint8Array(m);
    const flags = new Uint8Array(m);
    const edgeName = new Int32Array(m); // index into `names`
    for (let i = 0; i < m; i++) {
      const [a, b, lenDm, c, f, nm] = edges.slice(6 * i, 6 * i + 6);
      if (![a, b, lenDm, c, f, nm].every(isInt)) return { ok: false, error: "Map pack has an invalid road." };
      if (a < 0 || a >= n || b < 0 || b >= n || a === b) return { ok: false, error: "Map pack has a road to nowhere." };
      if (lenDm <= 0 || lenDm > 1e8) return { ok: false, error: "Map pack has an invalid road length." };
      if (c < 0 || c >= classes.length || c > 255 || nm < 0 || nm >= names.length || f < 0 || f > 7) {
        return { ok: false, error: "Map pack has an invalid road." };
      }
      ea[i] = a;
      eb[i] = b;
      len[i] = lenDm / 10;
      cls[i] = c;
      flags[i] = f;
      edgeName[i] = nm;
    }

    return {
      ok: true,
      graph: {
        name: typeof raw.name === "string" ? raw.name.slice(0, 120) : "Map pack",
        attribution: typeof raw.attribution === "string" ? raw.attribution.slice(0, 200) : "© OpenStreetMap contributors",
        bbox,
        nodeCount: n,
        edgeCount: m,
        lat, lon, ea, eb, len, cls, flags, edgeName,
        names: names.map((s) => (typeof s === "string" ? s.slice(0, 120) : "")),
        classes: classes.map((s) => (typeof s === "string" ? s.slice(0, 40) : "")),
        modes: {}, // built on first use, per travel mode
      },
    };
  } catch (err) {
    return { ok: false, error: `Map pack could not be read: ${err.message}` };
  }
}

/** Is this edge usable by this mode? */
export function allowed(graph, e, mode) {
  return (graph.flags[e] & (mode === DRIVE ? FLAG_DRIVE : FLAG_WALK)) !== 0;
}

/**
 * Per-mode adjacency (compressed rows), connected components, and a lookup grid for
 * finding the nearest road. Built once per mode, then cached on the graph.
 */
export function modeIndex(graph, mode) {
  if (graph.modes[mode]) return graph.modes[mode];
  const { nodeCount: n, edgeCount: m, ea, eb, flags } = graph;
  const bit = mode === DRIVE ? FLAG_DRIVE : FLAG_WALK;

  // Directed arcs: vehicles obey one-way (a -> b only); pedestrians go both ways.
  const deg = new Int32Array(n + 1);
  const oneWay = (e) => mode === DRIVE && (flags[e] & FLAG_ONEWAY) !== 0;
  for (let e = 0; e < m; e++) {
    if (!(flags[e] & bit)) continue;
    deg[ea[e]] += 1;
    if (!oneWay(e)) deg[eb[e]] += 1;
  }
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + deg[i];
  const fill = offsets.slice(0, n);
  const to = new Int32Array(offsets[n]);
  const arcEdge = new Int32Array(offsets[n]);
  const hasIn = new Uint8Array(n); // can be arrived at (matters for one-way streets)
  const degree = new Uint16Array(n); // roads meeting at this point: 2 is just a bend, 3+ is a junction
  const used = new Uint8Array(n); // touched by any road for this mode
  for (let e = 0; e < m; e++) {
    if (!(flags[e] & bit)) continue;
    used[ea[e]] = 1;
    used[eb[e]] = 1;
    degree[ea[e]] += 1;
    degree[eb[e]] += 1;
    to[fill[ea[e]]] = eb[e];
    arcEdge[fill[ea[e]]++] = e;
    hasIn[eb[e]] = 1;
    if (!oneWay(e)) {
      to[fill[eb[e]]] = ea[e];
      arcEdge[fill[eb[e]]++] = e;
      hasIn[ea[e]] = 1;
    }
  }

  // Connected components (ignoring direction), so a route is never attempted between
  // two disconnected road fragments and snapping can prefer the main network.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (let e = 0; e < m; e++) {
    if (!(flags[e] & bit)) continue;
    const ra = find(ea[e]);
    const rb = find(eb[e]);
    if (ra !== rb) parent[ra] = rb;
  }
  const component = new Int32Array(n);
  const size = new Map();
  for (let i = 0; i < n; i++) {
    component[i] = find(i);
    if (used[i]) size.set(component[i], (size.get(component[i]) || 0) + 1);
  }
  let largest = 0;
  for (const s of size.values()) largest = Math.max(largest, s);

  const index = { offsets, to, arcEdge, hasIn, degree, component, componentSize: size, largest, grid: null };
  graph.modes[mode] = index;
  index.grid = buildGrid(graph, index);
  return index;
}

// Roughly 150 m cells; only nodes that have a road for this mode are indexed.
function buildGrid(graph, index) {
  const { lat, lon, nodeCount: n } = graph;
  const cellLat = 0.00135;
  const midLat = graph.bbox[0] / 2 + graph.bbox[2] / 2;
  const cellLon = cellLat / Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    // only points you can both leave and arrive at are worth snapping to
    if (index.offsets[i + 1] === index.offsets[i] || !index.hasIn[i]) continue;
    const key = `${Math.floor(lat[i] / cellLat)},${Math.floor(lon[i] / cellLon)}`;
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  }
  return { cells, cellLat, cellLon };
}
