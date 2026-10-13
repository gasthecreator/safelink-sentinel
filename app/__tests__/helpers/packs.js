// Builds small routing packs by hand for tests (same format osmToPack produces).
const { haversineM } = require("../../scripts/lib/osmToPack.js");

const WALK = 1;
const DRIVE = 2;
const ONEWAY = 4;

/**
 * nodes: [[lat, lon], ...]
 * edges: [{a, b, cls = "residential", name = "", flags = WALK|DRIVE}]
 */
function makePack({ nodes, edges, bbox }) {
  const names = [""];
  const classes = [];
  const flat = [];
  for (const e of edges) {
    let n = names.indexOf(e.name || "");
    if (n < 0) { n = names.length; names.push(e.name); }
    const cname = e.cls || "residential";
    let c = classes.indexOf(cname);
    if (c < 0) { c = classes.length; classes.push(cname); }
    const [la, lo] = nodes[e.a];
    const [lb, lob] = nodes[e.b];
    const lenDm = Math.max(1, Math.round(haversineM(la, lo, lb, lob) * 10));
    flat.push(e.a, e.b, lenDm, c, e.flags === undefined ? WALK | DRIVE : e.flags, n);
  }
  const lats = nodes.map((p) => p[0]);
  const lons = nodes.map((p) => p[1]);
  return {
    format: 1,
    name: "Test pack",
    bbox: bbox || [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
    extent: [0, 0, 0, 0],
    nodes: nodes.flatMap(([la, lo]) => [Math.round(la * 1e6), Math.round(lo * 1e6)]),
    edges: flat,
    names,
    classes,
  };
}

/** A rows x cols street grid, ~100 m blocks, near Grambling. Node id = r * cols + c. */
function gridPack(rows, cols, { lat0 = 32.52, lon0 = -92.72, step = 0.0009, name = (dir, i) => `${dir} Street ${i}` } = {}) {
  const nodes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) nodes.push([lat0 + r * step, lon0 + c * step]);
  const edges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) edges.push({ a: r * cols + c, b: r * cols + c + 1, name: name("Row", r) });
      if (r + 1 < rows) edges.push({ a: r * cols + c, b: (r + 1) * cols + c, name: name("Col", c) });
    }
  }
  return { nodes, edges };
}

module.exports = { makePack, gridPack, WALK, DRIVE, ONEWAY };
