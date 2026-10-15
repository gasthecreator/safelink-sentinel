// app/services/maps/PackStore.js
// The map packs installed on this phone: files on disk plus a manifest of what they are.
//
// Installing is all-or-nothing and verified. A pack is downloaded to a temporary file; its size,
// its hash (which is in the signed catalog) and its structure are checked; only then does it
// replace anything. A failure at any step leaves the phone exactly as it was. Packs are files, not
// AsyncStorage values, because Android's AsyncStorage cannot reliably hold multi-megabyte values.
//
// All file access goes through a small adapter (see rnfsAdapter.js; tests supply a fake), so the
// whole pipeline, including its failures, is testable.

import { loadPack } from "../navigation/pack.js";
import { ID_PATTERN } from "./catalog.js";

export class PackError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MANIFEST = "manifest.json";
const MANIFEST_TMP = "manifest.tmp";
const SPACE_MARGIN = 5 * 1024 * 1024; // keep this much free after installing
const near = (a, b) => Math.abs(a - b) < 1e-6;
const sameBbox = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && a.every((v, i) => near(v, b[i]));

export function createPackStore(getFs) {
  let fs = null;
  let manifest = { format: 1, lastSequence: 0, packs: {} };
  let ready = null;
  let current = null; // the download in progress, if any

  const path = (name) => `${fs.root}/${name}`;
  const fileFor = (id, version) => `${id}-v${version}.json`;

  async function saveManifest() {
    // write beside, then move over: a crash mid-write cannot leave a half-written manifest
    await fs.writeText(path(MANIFEST_TMP), JSON.stringify(manifest));
    await fs.move(path(MANIFEST_TMP), path(MANIFEST));
  }

  async function load() {
    fs = getFs();
    await fs.mkdirp(fs.root);
    try {
      if (await fs.exists(path(MANIFEST))) {
        const saved = JSON.parse(await fs.readText(path(MANIFEST)));
        if (saved && saved.format === 1 && saved.packs && typeof saved.packs === "object") {
          const packs = {};
          for (const [id, e] of Object.entries(saved.packs)) {
            if (!ID_PATTERN.test(id) || !e || e.id !== id || typeof e.file !== "string" || e.file !== fileFor(id, e.version)) continue;
            if (await fs.exists(path(e.file))) packs[id] = e; // a manifest entry whose file has gone is dropped
          }
          manifest = {
            format: 1,
            lastSequence: Number.isInteger(saved.lastSequence) && saved.lastSequence >= 0 ? saved.lastSequence : 0,
            packs,
          };
        }
      }
    } catch (err) {
      console.log("[SafeLink][Maps] Could not read the map manifest, starting empty:", err.message);
    }
    // tidy up whatever a crash or a cancelled download left behind
    try {
      const keep = new Set([MANIFEST, ...Object.values(manifest.packs).map((e) => e.file)]);
      for (const name of await fs.list(fs.root)) if (!keep.has(name)) await fs.remove(path(name));
    } catch (err) {
      console.log("[SafeLink][Maps] Could not tidy the maps folder:", err.message);
    }
  }

  const store = {
    init() {
      if (!ready) ready = load();
      return ready;
    },

    async installed() {
      await store.init();
      return Object.values(manifest.packs).sort((a, b) => a.name.localeCompare(b.name));
    },

    async lastSequence() {
      await store.init();
      return manifest.lastSequence;
    },

    /** Remember the newest catalog sequence seen, so an older one is refused later. */
    async recordSequence(sequence) {
      await store.init();
      if (Number.isInteger(sequence) && sequence > manifest.lastSequence) {
        manifest.lastSequence = sequence;
        await saveManifest();
      }
    },

    async totalBytes() {
      return (await store.installed()).reduce((t, e) => t + e.sizeBytes, 0);
    },

    get busy() {
      return current !== null;
    },

    /** Stop the download in progress (if any). The phone is left as it was. */
    cancel() {
      if (current) current.cancel();
    },

    /**
     * Download and install one catalog entry, replacing an older version of the same map.
     * @throws {PackError} code: busy | no_space | download | cancelled | size | hash | invalid | storage
     */
    async install(entry, { onProgress } = {}) {
      await store.init();
      if (current) throw new PackError("busy", "Another map is already downloading.");
      if (!ID_PATTERN.test(entry.id)) throw new PackError("invalid", "That map has an invalid name.");

      const tmp = path(`${entry.id}-v${entry.version}.part`);
      const final = path(fileFor(entry.id, entry.version));
      const cleanup = () => fs.remove(tmp).catch(() => {});
      let download = null;
      try {
        const free = await fs.freeBytes().catch(() => Infinity);
        if (free < entry.sizeBytes + SPACE_MARGIN) {
          throw new PackError("no_space", `Not enough free space on this phone (this map needs ${(entry.sizeBytes / 1048576).toFixed(1)} MB).`);
        }

        await cleanup();
        download = fs.download({ url: entry.url, to: tmp, onProgress });
        current = download;
        try {
          await download.done;
        } catch (err) {
          if (err && err.cancelled) throw new PackError("cancelled", "Download cancelled.");
          throw new PackError("download", err && err.message ? `Download failed: ${err.message}` : "Download failed. Check the internet connection.");
        }

        if ((await fs.size(tmp)) !== entry.sizeBytes) {
          throw new PackError("size", "The downloaded map is not the size it should be, so it was not used.");
        }
        if ((await fs.sha256(tmp)) !== entry.sha256) {
          throw new PackError("hash", "The downloaded map does not match its checksum, so it was not used.");
        }

        let raw;
        try {
          raw = JSON.parse(await fs.readText(tmp));
        } catch {
          throw new PackError("invalid", "The downloaded map could not be read, so it was not used.");
        }
        const loaded = loadPack(raw);
        if (!loaded.ok) throw new PackError("invalid", `The downloaded map is not valid (${loaded.error}), so it was not used.`);
        // the area the catalog (which is signed) promised must be the area the file really covers
        if (!sameBbox(raw.bbox, entry.bbox)) {
          throw new PackError("invalid", "The downloaded map covers a different area than promised, so it was not used.");
        }

        const old = manifest.packs[entry.id];
        await fs.move(tmp, final);
        manifest.packs[entry.id] = {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          bbox: entry.bbox,
          sizeBytes: entry.sizeBytes,
          sha256: entry.sha256,
          file: fileFor(entry.id, entry.version),
          installedAt: Date.now(),
          builtAt: entry.builtAt || null,
          attribution: entry.attribution,
        };
        try {
          await saveManifest();
        } catch (err) {
          // could not record it: put things back so the phone is unchanged
          if (old) manifest.packs[entry.id] = old;
          else delete manifest.packs[entry.id];
          await fs.remove(final).catch(() => {});
          throw new PackError("storage", `Could not save the map: ${err.message}`);
        }
        if (old && old.file !== manifest.packs[entry.id].file) await fs.remove(path(old.file)).catch(() => {});
        return manifest.packs[entry.id];
      } catch (err) {
        await cleanup();
        if (err instanceof PackError) throw err;
        throw new PackError("storage", `Could not install the map: ${err && err.message ? err.message : err}`);
      } finally {
        current = null;
      }
    },

    async remove(id) {
      await store.init();
      const entry = manifest.packs[id];
      if (!entry) return false;
      delete manifest.packs[id];
      await saveManifest(); // forget it first, so a crash never leaves a manifest pointing at nothing
      await fs.remove(path(entry.file)).catch(() => {});
      return true;
    },

    /** The raw pack JSON for an installed map, ready for loadPack. */
    async read(id) {
      await store.init();
      const entry = manifest.packs[id];
      if (!entry) throw new PackError("invalid", "That map is not installed.");
      const p = path(entry.file);
      if ((await fs.size(p)) !== entry.sizeBytes) throw new PackError("size", "The saved map is damaged. Delete it and download it again.");
      try {
        return JSON.parse(await fs.readText(p));
      } catch {
        throw new PackError("invalid", "The saved map is damaged. Delete it and download it again.");
      }
    },

    async freeBytes() {
      await store.init();
      return fs.freeBytes().catch(() => null);
    },
  };
  return store;
}

// The store the app uses: real files, created on first use so tests never touch react-native-fs.
export default createPackStore(() => require("./rnfsAdapter.js").default);
