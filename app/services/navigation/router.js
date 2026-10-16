// app/services/navigation/router.js
// Routes over an offline pack: snap both ends to the nearest road, find the quickest way
// (A*), and turn it into plain turn-by-turn steps. Works for walking and driving.
// Everything here is plain JavaScript on arrays: no network, no native code.

import { loadPack, modeIndex, WALK, DRIVE } from "./pack.js";

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compassName = (bearing) => COMPASS[Math.round(bearing / 45) % 8];


const M_PER_DEG_LAT = 111320;

/** Metres from point p to the segment a-b (small areas: flat local projection). */
function pointToSegmentM(p, a, b) {
  const mLon = M_PER_DEG_LAT * Math.cos(rad(p.latitude));
  const px = 0;
  const py = 0;
  const ax = (a[1] - p.longitude) * mLon;
  const ay = (a[0] - p.latitude) * M_PER_DEG_LAT;
  const bx = (b[1] - p.longitude) * mLon;
  const by = (b[0] - p.latitude) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

/** Smallest distance from a point to a drawn route line. */
function distanceToLineM(p, geometry) {
  if (geometry.length === 1) return distanceM(p.latitude, p.longitude, geometry[0][0], geometry[0][1]);
  let best = Infinity;
  for (let i = 1; i < geometry.length; i++) best = Math.min(best, pointToSegmentM(p, geometry[i - 1], geometry[i]));
  return best;
}

const EDGE_CELL_DEG = 0.002; // about 220 m
const edgeGrids = new WeakMap();

// Which roads touch each cell of a coarse grid, built once per pack. A closure then only looks at the
// roads in the few cells it covers, instead of every road in the pack.
function edgeGrid(graph) {
  let grid = edgeGrids.get(graph);
  if (grid) return grid;
  const cells = new Map();
  const cell = (v) => Math.floor(v / EDGE_CELL_DEG);
  for (let e = 0; e < graph.edgeCount; e++) {
    const a = graph.ea[e];
    const b = graph.eb[e];
    const r0 = cell(Math.min(graph.lat[a], graph.lat[b]));
    const r1 = cell(Math.max(graph.lat[a], graph.lat[b]));
    const c0 = cell(Math.min(graph.lon[a], graph.lon[b]));
    const c1 = cell(Math.max(graph.lon[a], graph.lon[b]));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${r},${c}`;
        const list = cells.get(key);
        if (list) list.push(e);
        else cells.set(key, [e]);
      }
    }
  }
  grid = { cells, cell };
  edgeGrids.set(graph, grid);
  return grid;
}

/**
 * Which roads pass within each closure's radius. Returns the combined set (for the search)
 * and, per closure, its own edges (to tell which closures a route would have run into).
 */
function blockedEdges(graph, closures) {
  const blocked = new Uint8Array(graph.edgeCount);
  const perClosure = closures.map(() => []);
  const { cells, cell } = edgeGrid(graph);
  closures.forEach((c, ci) => {
    const dLat = c.radiusM / M_PER_DEG_LAT;
    const dLon = c.radiusM / (M_PER_DEG_LAT * Math.max(0.2, Math.cos(rad(c.latitude))));
    const seen = new Set(); // a long road sits in several cells but is tested once
    for (let r = cell(c.latitude - dLat); r <= cell(c.latitude + dLat); r++) {
      for (let col = cell(c.longitude - dLon); col <= cell(c.longitude + dLon); col++) {
        const list = cells.get(`${r},${col}`);
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e)) continue;
          seen.add(e);
          const a = graph.ea[e];
          const b = graph.eb[e];
          const la = graph.lat[a], lo = graph.lon[a], lb = graph.lat[b], lob = graph.lon[b];
          if (Math.max(la, lb) < c.latitude - dLat || Math.min(la, lb) > c.latitude + dLat) continue;
          if (Math.max(lo, lob) < c.longitude - dLon || Math.min(lo, lob) > c.longitude + dLon) continue;
          if (pointToSegmentM(c, [la, lo], [lb, lob]) <= c.radiusM) {
            blocked[e] = 1;
            perClosure[ci].push(e);
          }
        }
      }
    }
    perClosure[ci].sort((x, y) => x - y); // same order as scanning every road
  });
  return { blocked, perClosure };
}

// Speeds in metres per second. Walking is the same on any road except steps.
const WALK_SPEED = 1.4;
const DRIVE_SPEED = {
  motorway: 27, motorway_link: 17, trunk: 22, trunk_link: 14, primary: 16, primary_link: 11,
  secondary: 13.5, secondary_link: 9, tertiary: 11, tertiary_link: 8, unclassified: 10,
  residential: 8.5, living_street: 4, service: 4, track: 3,
};
const MAX_SPEED = { [WALK]: WALK_SPEED, [DRIVE]: 27 };

function edgeSpeed(graph, e, mode) {
  const cls = graph.classes[graph.cls[e]];
  if (mode === DRIVE) return DRIVE_SPEED[cls] || 8;
  return cls === "steps" ? 0.8 : WALK_SPEED;
}

const PLAIN_NAME = {
  footway: "the footpath", path: "the path", steps: "the steps", track: "the track",
  service: "the service road", pedestrian: "the pedestrian way", cycleway: "the cycle path",
  residential: "the street", unclassified: "the road", living_street: "the street",
};
const describeRoad = (graph, e) => graph.names[graph.edgeName[e]] || PLAIN_NAME[graph.classes[graph.cls[e]]] || "the road";

/** Nearest usable road point to (lat, lon) for a mode, preferring the main network. */
function snap(graph, mode, lat, lon) {
  const index = modeIndex(graph, mode);
  const { cells, cellLat, cellLon } = index.grid;
  const ci = Math.floor(lat / cellLat);
  const cj = Math.floor(lon / cellLon);
  let best = -1;
  let bestD = Infinity;
  // A tiny fragment of road (a car-park aisle) is a poor place to start a route.
  const minSize = Math.min(50, index.largest);
  const consider = (rings) => {
    for (let di = -rings; di <= rings; di++) {
      for (let dj = -rings; dj <= rings; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rings) continue; // only the new ring
        const cell = cells.get(`${ci + di},${cj + dj}`);
        if (!cell) continue;
        for (const i of cell) {
          if ((index.componentSize.get(index.component[i]) || 0) < minSize) continue;
          const d = distanceM(lat, lon, graph.lat[i], graph.lon[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
  };
  for (let rings = 0; rings <= 40; rings++) {
    consider(rings);
    // once something is found, one more ring can still hold a closer point
    if (best >= 0 && bestD < rings * cellLat * 111000 * 0.7) break;
  }
  return best >= 0 ? { node: best, offM: bestD } : null;
}

// Binary min-heap of node indices ordered by a priority array.
class Heap {
  constructor(priority) { this.items = []; this.priority = priority; }
  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.priority[a[p]] <= this.priority[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.priority[a[l]] < this.priority[a[m]]) m = l;
        if (r < a.length && this.priority[a[r]] < this.priority[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

function shortestPath(graph, mode, from, to, blocked = null) {
  const index = modeIndex(graph, mode);
  const n = graph.nodeCount;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const vmax = MAX_SPEED[mode];
  const h = (i) => distanceM(graph.lat[i], graph.lon[i], graph.lat[to], graph.lon[to]) / vmax;

  g[from] = 0;
  f[from] = h(from);
  const heap = new Heap(f);
  heap.push(from);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (let k = index.offsets[u]; k < index.offsets[u + 1]; k++) {
      const v = index.to[k];
      if (done[v]) continue;
      const e = index.arcEdge[k];
      if (blocked && blocked[e]) continue;
      const cost = g[u] + graph.len[e] / edgeSpeed(graph, e, mode);
      if (cost < g[v]) {
        g[v] = cost;
        f[v] = cost + h(v);
        prev[v] = u;
        prevEdge[v] = e;
        heap.push(v);
      }
    }
  }
  if (!done[to]) return null;
  const nodes = [to];
  const edges = [];
  for (let v = to; v !== from; v = prev[v]) {
    edges.push(prevEdge[v]);
    nodes.push(prev[v]);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse(), seconds: g[to] };
}

const TURN_AT = 35; // degrees: below this at a junction onto a different road it is simply "continue"
const SAME_ROAD_TURN_AT = 60; // staying on the same named road, only a real turn is worth a step
const MIN_LEG_M = 15; // a shorter stretch than this is a jog, not a step worth announcing

const angleBetween = (outBearing, inBearing) => ((outBearing - inBearing + 540) % 360) - 180;

/**
 * Plain-language turn-by-turn from the chosen edges.
 * A new step starts when the road name changes, or you turn by TURN_AT degrees or more at
 * a junction (somewhere another road meets). A bend in a road with nothing branching off,
 * on the same street, is not a step. Very short stretches are folded into their neighbour.
 */
function buildSteps(graph, nodes, edges, mode) {
  const index = modeIndex(graph, mode);
  const pt = (i) => [graph.lat[nodes[i]], graph.lon[nodes[i]]];
  // bearing over the nearest ~30 m on one side of point i, so tiny kinks don't read as turns
  const bearingAround = (i, forward) => {
    const [la, lo] = pt(i);
    let j = i;
    let travelled = 0;
    while (travelled < 30 && (forward ? j + 1 < nodes.length : j > 0)) {
      const k = forward ? j + 1 : j - 1;
      travelled += distanceM(...pt(j), ...pt(k));
      j = k;
    }
    const [lb, lob] = pt(j);
    return forward ? bearingDeg(la, lo, lb, lob) : bearingDeg(lb, lob, la, lo);
  };

  // Group edges into legs. edge k runs from nodes[k] to nodes[k+1]; the junction between
  // edge k-1 and edge k is nodes[k].
  const legs = [];
  let cur = null;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const label = describeRoad(graph, e);
    let turn = 0;
    let isJunction = false;
    if (k > 0) {
      turn = angleBetween(bearingAround(k, true), bearingAround(k, false));
      isJunction = index.degree[nodes[k]] >= 3;
    }
    const sameRoad = cur && label === cur.label;
    const newLeg = !cur || !sameRoad || (isJunction && Math.abs(turn) >= SAME_ROAD_TURN_AT);
    if (newLeg) {
      cur = { label, startIdx: k, distanceM: 0, turn };
      legs.push(cur);
    }
    cur.distanceM += graph.len[e];
  }

  // Fold short jogs into the leg that follows. The merged leg starts where the jog began, and
  // its turn is the net change of direction from before the jog to after it (a quick
  // left-right dogleg nets out to roughly straight on).
  const folded = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const isLast = i === legs.length - 1;
    if (i > 0 && !isLast && leg.distanceM < MIN_LEG_M) {
      const next = legs[i + 1];
      next.turn = angleBetween(bearingAround(next.startIdx, true), bearingAround(leg.startIdx, false));
      next.startIdx = leg.startIdx;
      next.distanceM += leg.distanceM;
      continue;
    }
    folded.push(leg);
  }
  // Two neighbouring legs on the same road with no real turn between them are one step.
  const merged = [];
  for (const leg of folded) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === leg.label && Math.abs(leg.turn) < SAME_ROAD_TURN_AT) {
      prev.distanceM += leg.distanceM;
    } else {
      merged.push(leg);
    }
  }

  // distance along the route at each node, so a step knows where on the route it happens
  const cum = [0];
  for (const e of edges) cum.push(cum[cum.length - 1] + graph.len[e]);

  const steps = merged.map((leg, idx) => {
    const [lat, lon] = pt(leg.startIdx);
    const t = leg.turn;
    const abs = Math.abs(t);
    const side = t < 0 ? "left" : "right";
    // turning but staying on the same named road: no "onto"
    const onto = idx > 0 && merged[idx - 1].label === leg.label ? "" : ` onto ${leg.label}`;
    let text;
    if (idx === 0) text = `Head ${compassName(bearingAround(0, true))} on ${leg.label}`;
    else if (abs >= 170) text = `Make a U-turn${onto}`;
    else if (abs >= 120) text = `Turn sharp ${side}${onto}`;
    else if (abs >= 60) text = `Turn ${side}${onto}`;
    else if (abs >= 20) text = `Bear ${side}${onto}`;
    else text = `Continue onto ${leg.label}`;
    return { text, distanceM: Math.round(leg.distanceM), lat, lon, alongM: Math.round(cum[leg.startIdx]) };
  });
  // Never read the same instruction twice in a row: two gentle bends in a row are one bend.
  const deduped = [];
  for (const step of steps) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text === step.text) prev.distanceM += step.distanceM;
    else deduped.push(step);
  }
  const [endLat, endLon] = pt(nodes.length - 1);
  deduped.push({ text: "You have arrived", distanceM: 0, lat: endLat, lon: endLon, alongM: Math.round(cum[cum.length - 1]) });
  return deduped;
}

const inCoverage = (graph, lat, lon, marginDeg = 0.003) => {
  const [s, w, n, e] = graph.bbox;
  return lat >= s - marginDeg && lat <= n + marginDeg && lon >= w - marginDeg && lon <= e + marginDeg;
};

const validPoint = (p) =>
  p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

/**
 * @param {object} graph from loadPack
 * @param {{latitude:number, longitude:number}} from
 * @param {{latitude:number, longitude:number}} to
 * @param {{mode?: "walk"|"drive", avoid?: object[]}} options
 *   avoid: closures from effectiveClosures(); "blocked" ones are routed around, "hazard"
 *   ones are only reported when the route passes close to them
 * @returns {{ok:true, mode, distanceM, durationS, geometry:number[][], steps, start, end, warnings:string[]}
 *         | {ok:false, reason:string, message:string}}
 */
export function route(graph, from, to, { mode = WALK, avoid = [], formatDistance = (m) => `${Math.round(m)} m` } = {}) {
  if (!validPoint(from) || !validPoint(to)) {
    return { ok: false, reason: "bad_input", message: "A position was missing or invalid." };
  }
  if (!inCoverage(graph, from.latitude, from.longitude)) {
    return { ok: false, reason: "outside_pack", message: `Your position is outside the "${graph.name}" map.` };
  }
  if (!inCoverage(graph, to.latitude, to.longitude)) {
    return { ok: false, reason: "outside_pack", message: `Their position is outside the "${graph.name}" map.` };
  }

  const a = snap(graph, mode, from.latitude, from.longitude);
  const b = snap(graph, mode, to.latitude, to.longitude);
  if (!a || !b) return { ok: false, reason: "no_road_near", message: "No road in the map is near one of the positions." };

  const warnings = [];
  const OFF_ROAD_WARN_M = 150;
  if (a.offM > OFF_ROAD_WARN_M) warnings.push(`The nearest known road to you is ${formatDistance(a.offM)} away.`);
  if (b.offM > OFF_ROAD_WARN_M) warnings.push(`The nearest known road to them is ${formatDistance(b.offM)} away.`);

  const snappedStart = { latitude: graph.lat[a.node], longitude: graph.lon[a.node], offM: Math.round(a.offM) };
  const snappedEnd = { latitude: graph.lat[b.node], longitude: graph.lon[b.node], offM: Math.round(b.offM) };

  if (a.node === b.node) {
    return {
      ok: true, mode, distanceM: Math.round(distanceM(from.latitude, from.longitude, to.latitude, to.longitude)),
      durationS: 0, geometry: [[snappedStart.latitude, snappedStart.longitude]],
      steps: [{ text: "You are at the nearest road point to them", distanceM: 0, lat: snappedStart.latitude, lon: snappedStart.longitude }],
      start: snappedStart, end: snappedEnd, warnings,
    };
  }

  const index = modeIndex(graph, mode);
  if (index.component[a.node] !== index.component[b.node]) {
    return { ok: false, reason: "no_route", message: "The map has no connected route between these two places." };
  }
  // Closures near either end are not allowed to make the trip impossible: if you are standing
  // at a reported blockage you still need to get away from it, and if they are beside one you
  // still need to reach them. They are reported as warnings instead.
  const NEAR_END_M = 60;
  const closures = [];
  for (const c of avoid) {
    if (!c || c.kind !== "blocked" || !validPoint(c) || !(c.radiusM > 0)) continue;
    const nearEnd = [snappedStart, snappedEnd].some((p) => distanceM(c.latitude, c.longitude, p.latitude, p.longitude) <= c.radiusM + NEAR_END_M);
    if (nearEnd) warnings.push("A road closure is reported right at your start or at their position; the route may pass through it.");
    else closures.push(c);
  }
  const closureEdges = closures.length ? blockedEdges(graph, closures) : null;

  const baseline = shortestPath(graph, mode, a.node, b.node);
  const path = closureEdges ? shortestPath(graph, mode, a.node, b.node, closureEdges.blocked) : baseline;
  if (!path) {
    if (closureEdges && baseline) {
      return {
        ok: false,
        reason: "blocked_by_reports",
        message: "Reported road closures block every route this map knows. Reports can be wrong; you can show the route anyway.",
        closures: closures.length,
      };
    }
    return {
      ok: false, reason: "no_route",
      message: mode === DRIVE ? "No route by road (one-way streets may block it). Try walking." : "No route found.",
    };
  }

  // Which reported closures did the quickest route (without reports) run into? Those were avoided.
  let detour = null;
  if (closureEdges && baseline && baseline.edges.some((e) => closureEdges.blocked[e])) {
    const hit = new Set(baseline.edges);
    const avoided = closures.filter((_, i) => closureEdges.perClosure[i].some((e) => hit.has(e)));
    const sum = (edges) => edges.reduce((t, e) => t + graph.len[e], 0);
    detour = {
      closures: avoided,
      extraM: Math.round(sum(path.edges) - sum(baseline.edges)),
      extraS: Math.round(path.seconds - baseline.seconds),
    };
  }

  const geometry = path.nodes.map((i) => [graph.lat[i], graph.lon[i]]);
  let total = 0;
  for (const e of path.edges) total += graph.len[e];
  const hazardsOnRoute = avoid.filter(
    (c) => c && c.kind === "hazard" && validPoint(c) && distanceToLineM(c, geometry) <= (c.radiusM || 40) + 20
  );
  return {
    ok: true,
    mode,
    distanceM: Math.round(total),
    durationS: Math.round(path.seconds),
    geometry,
    detour,
    hazardsOnRoute,
    steps: buildSteps(graph, path.nodes, path.edges, mode),
    start: snappedStart,
    end: snappedEnd,
    warnings,
  };
}

/** Convenience: load a pack object and return a router bound to it. */
export function createRouter(rawPack) {
  const loaded = loadPack(rawPack);
  if (!loaded.ok) return loaded;
  const { graph } = loaded;
  return { ok: true, graph, route: (from, to, options) => route(graph, from, to, options) };
}

export { WALK, DRIVE };

// exposed for tests only
export const __internals = { blockedEdges, pointToSegmentM };
