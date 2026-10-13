// app/services/navigation/mapView.js
// Pure helpers for drawing the offline map: fitting a view to some points, projecting
// coordinates to pixels, choosing which roads to draw, and a scale bar.

const M_PER_DEG_LAT = 111320;

/**
 * Fit the points into width x height with padding. Equirectangular projection (good for a
 * town or city). zoom > 1 zooms in about the centre of the points.
 */
export function projector(points, { width, height, zoom = 1, pad = 24 }) {
  const pts = points.filter((p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (!pts.length) {
    return { project: () => ({ x: width / 2, y: height / 2 }), bounds: null, metersPerPixel: 1 };
  }
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const p of pts) {
    s = Math.min(s, p.latitude); n = Math.max(n, p.latitude);
    w = Math.min(w, p.longitude); e = Math.max(e, p.longitude);
  }
  const midLat = (s + n) / 2;
  const midLon = (w + e) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const mPerDegLon = M_PER_DEG_LAT * cosLat;

  // Never zoom in tighter than ~60 m across, even for a single point or two very close ones.
  const spanXm = Math.max((e - w) * mPerDegLon, 60);
  const spanYm = Math.max((n - s) * M_PER_DEG_LAT, 60);
  const metersPerPixel = Math.max(spanXm / (width - 2 * pad), spanYm / (height - 2 * pad)) / zoom;

  const project = (lat, lon) => ({
    x: width / 2 + ((lon - midLon) * mPerDegLon) / metersPerPixel,
    y: height / 2 - ((lat - midLat) * M_PER_DEG_LAT) / metersPerPixel,
  });
  const halfLat = (height / 2) * metersPerPixel / M_PER_DEG_LAT;
  const halfLon = (width / 2) * metersPerPixel / mPerDegLon;
  return {
    project,
    metersPerPixel,
    bounds: { south: midLat - halfLat, north: midLat + halfLat, west: midLon - halfLon, east: midLon + halfLon },
  };
}

const MAJOR = new Set(["motorway", "motorway_link", "trunk", "primary", "secondary", "tertiary"]);

/**
 * Road segments inside the view. If there are too many to draw smoothly, keep the major
 * roads first, then fill with the rest.
 */
export function pickRoads(graph, bounds, limit = 1800) {
  if (!bounds) return [];
  const inside = [];
  for (let e = 0; e < graph.edgeCount; e++) {
    const a = graph.ea[e];
    const b = graph.eb[e];
    const la = graph.lat[a], lo = graph.lon[a], lb = graph.lat[b], lob = graph.lon[b];
    if (Math.max(la, lb) < bounds.south || Math.min(la, lb) > bounds.north) continue;
    if (Math.max(lo, lob) < bounds.west || Math.min(lo, lob) > bounds.east) continue;
    inside.push({ key: e, a: [la, lo], b: [lb, lob], major: MAJOR.has(graph.classes[graph.cls[e]]) });
  }
  if (inside.length <= limit) return inside;
  const major = inside.filter((r) => r.major);
  const minor = inside.filter((r) => !r.major);
  return major.concat(minor.slice(0, Math.max(0, limit - major.length)));
}

/** A round-number scale bar no wider than ~110 px: { pixels, label }. */
export function scaleBar(metersPerPixel, maxPixels = 110) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  let best = steps[0];
  for (const m of steps) if (m / metersPerPixel <= maxPixels) best = m;
  return { pixels: Math.max(8, Math.round(best / metersPerPixel)), label: best >= 1000 ? `${best / 1000} km` : `${best} m` };
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10 || Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatDuration(s) {
  const minutes = Math.round(s / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
