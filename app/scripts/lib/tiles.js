// Fetching a big area from Overpass in tiles and joining the pieces into one OSM data set.
// The public servers refuse (or time out on) large requests, so a big area is asked for as a grid of
// small tiles. Because Overpass returns every road that touches a tile along with all its points, a
// road that crosses a tile edge arrives in both tiles with the same ids; joining by id makes it one road.

const MAX_TILE_AREA = 0.04;   // square degrees per request (about 400 km2)
const MAX_TOTAL_AREA = 1.0;   // square degrees for a whole pack (about 10,000 km2, roughly 25 MB)

/** Split bbox [s,w,n,e] into a grid of tiles no larger than maxArea, covering it exactly. */
function splitBbox([s, w, n, e], maxArea = MAX_TILE_AREA) {
  const area = (n - s) * (e - w);
  const pieces = Math.max(1, Math.ceil(area / maxArea));
  const aspect = (e - w) / (n - s);
  let cols = Math.max(1, Math.round(Math.sqrt(pieces * aspect)));
  let rows = Math.max(1, Math.ceil(pieces / cols));
  while ((n - s) / rows * ((e - w) / cols) > maxArea) {
    if ((e - w) / cols > (n - s) / rows) cols++;
    else rows++;
  }
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // computed from the ends, not by adding, so the grid meets the outer edge exactly
      tiles.push([
        r === 0 ? s : s + ((n - s) * r) / rows,
        c === 0 ? w : w + ((e - w) * c) / cols,
        r === rows - 1 ? n : s + ((n - s) * (r + 1)) / rows,
        c === cols - 1 ? e : w + ((e - w) * (c + 1)) / cols,
      ]);
    }
  }
  return tiles;
}

/** Join several Overpass JSON results, keeping each node and way once. */
function mergeOverpass(results) {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  for (const result of results) {
    for (const el of result.elements || []) {
      if (el.type === "node") {
        // a place and a road point can be the same OSM node: keep the one that carries the tags
        const have = nodes.get(el.id);
        if (!have || (el.tags && !have.tags)) nodes.set(el.id, el);
      } else if (el.type === "way") {
        const have = ways.get(el.id);
        // a road comes with its list of points; a place's outline only has a centre. Keep the fuller one.
        if (!have || (el.nodes && !have.nodes)) ways.set(el.id, el);
      } else if (el.type === "relation") {
        relations.set(el.id, el);
      }
    }
  }
  return { elements: [...nodes.values(), ...ways.values(), ...relations.values()] };
}

module.exports = { splitBbox, mergeOverpass, MAX_TILE_AREA, MAX_TOTAL_AREA };
