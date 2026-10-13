// app/services/navigation/packs.js
// Which offline map packs the phone has, and which one covers a trip.
// For now the only pack is the bundled sample; later ones can be added to PACKS (and,
// once packs are downloaded to the phone, loaded from storage) without touching callers.

import { loadPack } from "./pack.js";

const PACKS = [
  { id: "grambling-la", load: () => require("../../assets/maps/grambling-la.json") },
];

const cache = new Map();

/** A loaded pack by id (cached), or {ok:false}. */
export function getPack(id) {
  if (cache.has(id)) return cache.get(id);
  const entry = PACKS.find((p) => p.id === id);
  const result = entry ? loadPack(entry.load()) : { ok: false, error: "Unknown map pack." };
  if (result.ok) cache.set(id, result);
  return result;
}

const covers = (graph, p, margin = 0.003) => {
  const [s, w, n, e] = graph.bbox;
  return p.latitude >= s - margin && p.latitude <= n + margin && p.longitude >= w - margin && p.longitude <= e + margin;
};

/**
 * The first pack that covers every point, or null. `partial` is a pack that covers at
 * least one of them, so the screen can say which end is missing.
 */
export function findPackFor(points) {
  let partial = null;
  for (const entry of PACKS) {
    const loaded = getPack(entry.id);
    if (!loaded.ok) continue;
    const hits = points.filter((p) => covers(loaded.graph, p)).length;
    if (hits === points.length) return { pack: loaded.graph, partial: null };
    if (hits > 0 && !partial) partial = loaded.graph;
  }
  return { pack: null, partial };
}

export function listPacks() {
  return PACKS.map((p) => {
    const loaded = getPack(p.id);
    return loaded.ok ? { id: p.id, name: loaded.graph.name, bbox: loaded.graph.bbox } : { id: p.id, name: p.id, error: loaded.error };
  });
}
