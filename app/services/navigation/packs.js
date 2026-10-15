// app/services/navigation/packs.js
// Which offline map packs the phone has, and which one covers a trip.
// Two sources: the bundled sample, and packs downloaded to the phone (see services/maps).
// A downloaded pack replaces a bundled one with the same id. Packs load lazily and are cached.

import { loadPack } from "./pack.js";

const BUNDLED = [
  { id: "grambling-la", load: () => require("../../assets/maps/grambling-la.json") },
];

const cache = new Map(); // "id@version" -> loaded result (only successes)

// The installed-pack store is looked up on first use so tests and pure callers never load react-native-fs.
let installedSource = null;
export function setInstalledSource(source) {
  installedSource = source;
  cache.clear();
}
const installedStore = () => installedSource || (installedSource = require("../maps/PackStore.js").default);

/** Every usable pack: { id, version, name, bbox, load: async () => loaded }. Installed ones win by id. */
async function sources() {
  const byId = new Map();
  for (const b of BUNDLED) {
    byId.set(b.id, { id: b.id, version: "bundled", load: async () => loadPack(b.load()) });
  }
  let installed = [];
  try {
    installed = await installedStore().installed();
  } catch (err) {
    console.log("[SafeLink][Maps] Could not read installed maps:", err.message);
  }
  for (const e of installed) {
    byId.set(e.id, {
      id: e.id,
      version: e.version,
      bbox: e.bbox,
      load: async () => {
        try {
          return loadPack(await installedStore().read(e.id));
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },
    });
  }
  return [...byId.values()];
}

async function loaded(src) {
  const key = `${src.id}@${src.version}`;
  if (cache.has(key)) return cache.get(key);
  const result = await src.load();
  if (result.ok) cache.set(key, result);
  return result;
}

const covers = (bbox, p, margin = 0.003) => {
  const [s, w, n, e] = bbox;
  return p.latitude >= s - margin && p.latitude <= n + margin && p.longitude >= w - margin && p.longitude <= e + margin;
};

/**
 * The first pack that covers every point, or null. `partial` is a pack that covers at
 * least one of them, so the screen can say which end is missing.
 * Only packs whose area could matter are read from storage.
 */
export async function findPackFor(points) {
  let partial = null;
  for (const src of await sources()) {
    const known = src.bbox; // installed packs carry their bbox in the manifest
    if (known && !points.some((p) => covers(known, p))) continue;
    const result = await loaded(src);
    if (!result.ok) continue;
    const hits = points.filter((p) => covers(result.graph.bbox, p)).length;
    if (hits === points.length) return { pack: result.graph, partial: null };
    if (hits > 0 && !partial) partial = result.graph;
  }
  return { pack: null, partial };
}

export async function getPack(id) {
  const src = (await sources()).find((s) => s.id === id);
  return src ? loaded(src) : { ok: false, error: "Unknown map pack." };
}

/** What is on the phone, for the maps screen: [{id, name, bbox, bundled, version}] */
export async function listPacks() {
  const out = [];
  for (const src of await sources()) {
    const result = await loaded(src);
    out.push(result.ok
      ? { id: src.id, name: result.graph.name, bbox: result.graph.bbox, bundled: src.version === "bundled", version: src.version }
      : { id: src.id, name: src.id, error: result.error });
  }
  return out;
}
