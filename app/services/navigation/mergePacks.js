// app/services/navigation/mergePacks.js
// Joining several loaded map packs into one road network, so a route can cross from one map into the next.
//
// Packs built for neighbouring areas include every road that crosses their edge (whole), so the two packs share
// the points of those roads. Points are matched by position (the packs store them to a millionth of a degree,
// about 11 cm), roads present in both are kept once, and the result is an ordinary graph the router already
// understands. Nothing here guesses: if the packs do not actually connect, the router says there is no route.

const key = (latE6, lonE6) => `${latE6},${lonE6}`;

/** True if two map areas overlap or touch (within `margin` degrees, about 330 m). */
export function bboxesTouch(a, b, margin = 0.003) {
  return a[0] - margin <= b[2] && b[0] - margin <= a[2] && a[1] - margin <= b[3] && b[1] - margin <= a[3];
}

/** The union of map areas. Only meaningful when they touch, which the caller checks. */
export function unionBbox(boxes) {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Merge loaded graphs (from loadPack) into one new graph. The inputs are not changed.
 * @returns {object} a graph with the same shape loadPack returns
 */
export function mergeGraphs(graphs) {
  if (!Array.isArray(graphs) || graphs.length === 0) throw new Error("Nothing to merge");
  if (graphs.length === 1) return graphs[0];

  const nodeIndex = new Map();
  const lat = [];
  const lon = [];
  const classes = [];
  const classIndex = new Map();
  const names = [""];
  const nameIndex = new Map([["", 0]]);
  const edges = { ea: [], eb: [], len: [], cls: [], flags: [], name: [] };
  const seenEdge = new Set();

  for (const g of graphs) {
    const nodeMap = new Int32Array(g.nodeCount);
    for (let i = 0; i < g.nodeCount; i++) {
      const k = key(Math.round(g.lat[i] * 1e6), Math.round(g.lon[i] * 1e6));
      let at = nodeIndex.get(k);
      if (at === undefined) {
        at = lat.length;
        nodeIndex.set(k, at);
        lat.push(g.lat[i]);
        lon.push(g.lon[i]);
      }
      nodeMap[i] = at;
    }
    const classMap = g.classes.map((c) => {
      let at = classIndex.get(c);
      if (at === undefined) { at = classes.length; classes.push(c); classIndex.set(c, at); }
      return at;
    });
    const nameMap = g.names.map((n) => {
      let at = nameIndex.get(n);
      if (at === undefined) { at = names.length; names.push(n); nameIndex.set(n, at); }
      return at;
    });
    for (let e = 0; e < g.edgeCount; e++) {
      const a = nodeMap[g.ea[e]];
      const b = nodeMap[g.eb[e]];
      if (a === b) continue;
      const dup = `${a}:${b}:${g.len[e]}:${g.flags[e]}:${classMap[g.cls[e]]}`;
      if (seenEdge.has(dup)) continue; // the same road, present in both maps
      seenEdge.add(dup);
      edges.ea.push(a);
      edges.eb.push(b);
      edges.len.push(g.len[e]);
      edges.cls.push(classMap[g.cls[e]]);
      edges.flags.push(g.flags[e]);
      edges.name.push(nameMap[g.edgeName[e]]);
    }
  }
  if (classes.length > 255) throw new Error("Too many road classes to merge");

  // places: the same kind, name and spot in two maps is one place
  const poiKinds = [];
  const poiRows = [];
  const seenPoi = new Set();
  for (const g of graphs) {
    const p = g.pois;
    if (!p || !p.count) continue;
    for (let i = 0; i < p.count; i++) {
      const kind = p.kinds[p.kind[i]];
      const nameText = g.names[p.name[i]];
      const dup = `${kind}|${nameText}|${Math.round(p.lat[i] * 1e4)}|${Math.round(p.lon[i] * 1e4)}`;
      if (seenPoi.has(dup)) continue;
      seenPoi.add(dup);
      let k = poiKinds.indexOf(kind);
      if (k < 0) { k = poiKinds.length; poiKinds.push(kind); }
      let n = nameIndex.get(nameText);
      if (n === undefined) { n = names.length; names.push(nameText); nameIndex.set(nameText, n); }
      poiRows.push([k, p.lat[i], p.lon[i], n]);
    }
  }
  const pois = {
    count: poiRows.length,
    kinds: poiKinds,
    kind: Uint8Array.from(poiRows.map((r) => r[0])),
    lat: Float64Array.from(poiRows.map((r) => r[1])),
    lon: Float64Array.from(poiRows.map((r) => r[2])),
    name: Int32Array.from(poiRows.map((r) => r[3])),
  };

  return {
    name: graphs.map((g) => g.name).join(" + ").slice(0, 120),
    attribution: graphs[0].attribution,
    bbox: unionBbox(graphs.map((g) => g.bbox)),
    merged: graphs.length,
    nodeCount: lat.length,
    edgeCount: edges.ea.length,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    ea: Int32Array.from(edges.ea),
    eb: Int32Array.from(edges.eb),
    len: Float32Array.from(edges.len),
    cls: Uint8Array.from(edges.cls),
    flags: Uint8Array.from(edges.flags),
    edgeName: Int32Array.from(edges.name),
    pois,
    names,
    classes,
    modes: {},
  };
}
