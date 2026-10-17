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
import { t } from "../i18n/i18n.js";

export class PackError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MANIFEST = "manifest.json";
const MANIFEST_TMP = "manifest.tmp";
const PARTIAL = "partial.json"; // which download's pieces are being kept so it can resume
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const CHUNK_RETRIES = 3;
const SPACE_MARGIN = 5 * 1024 * 1024; // keep this much free after installing
const near = (a, b) => Math.abs(a - b) < 1e-6;
const sameBbox = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && a.every((v, i) => near(v, b[i]));

export function createPackStore(getFs, { chunkBytes = DEFAULT_CHUNK_BYTES, retryDelayMs = 1500 } = {}) {
  let fs = null;
  let manifest = { format: 1, lastSequence: 0, retired: [], packs: {} };
  let ready = null;
  let current = null; // the download in progress, if any

  const path = (name) => `${fs.root}/${name}`;
  const fileFor = (id, version) => `${id}-v${version}.json`;

  const chunkName = (part, i) => `${part.id}-v${part.version}.c${i}`;
  const chunkCount = (size, chunk) => Math.ceil(size / chunk);
  const chunkLen = (part, i) => Math.min(part.chunkBytes, part.sizeBytes - i * part.chunkBytes);

  async function readPartial() {
    try {
      if (!(await fs.exists(path(PARTIAL)))) return null;
      const p = JSON.parse(await fs.readText(path(PARTIAL)));
      const ok =
        p && ID_PATTERN.test(p.id) && Number.isInteger(p.version) && Number.isInteger(p.sizeBytes) && p.sizeBytes > 0 &&
        Number.isInteger(p.chunkBytes) && p.chunkBytes > 0 && typeof p.sha256 === "string";
      return ok ? p : null;
    } catch {
      return null;
    }
  }

  async function clearPartial() {
    const part = await readPartial();
    if (part) for (let i = 0; i < chunkCount(part.sizeBytes, part.chunkBytes); i++) await fs.remove(path(chunkName(part, i))).catch(() => {});
    await fs.remove(path(PARTIAL)).catch(() => {});
  }

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
            retired: Array.isArray(saved.retired) ? saved.retired.filter((k) => typeof k === "string").slice(0, 32) : [],
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
      // the pieces of one interrupted download are kept so it can carry on where it stopped
      const part = await readPartial();
      if (part) {
        keep.add(PARTIAL);
        for (let i = 0; i < chunkCount(part.sizeBytes, part.chunkBytes); i++) keep.add(chunkName(part, i));
      }
      for (const name of await fs.list(fs.root)) if (!keep.has(name)) await fs.remove(path(name));
    } catch (err) {
      console.log("[SafeLink][Maps] Could not tidy the maps folder:", err.message);
    }
  }

  // Download an entry into `tmp`. A big map is fetched in pieces (HTTP Range requests) that are kept on
  // disk, so a dropped connection or a cancel resumes from the last finished piece. A server that does
  // not support ranges gets a plain single download.
  async function fetchInto(entry, tmp, onProgress) {
    const report = (bytes) => onProgress && onProgress({ bytes, total: entry.sizeBytes });
    const fail = (err) => {
      if (err && err.cancelled) throw new PackError("cancelled", t("Download cancelled."));
      throw new PackError("download", err && err.message ? t("Download failed: {reason}", { reason: err.message }) : t("Download failed. Check the internet connection."));
    };
    const single = async () => {
      await clearPartial();
      const job = fs.download({ url: entry.url, to: tmp, onProgress });
      current = job;
      try {
        await job.done;
      } catch (err) {
        fail(err);
      }
    };
    const n = chunkCount(entry.sizeBytes, chunkBytes);
    if (n <= 1 || !fs.downloadRange) return single();

    let part = await readPartial();
    const same = part && part.id === entry.id && part.version === entry.version && part.sha256 === entry.sha256 &&
      part.sizeBytes === entry.sizeBytes && part.chunkBytes === chunkBytes;
    if (!same) {
      await clearPartial();
      part = { id: entry.id, version: entry.version, sha256: entry.sha256, sizeBytes: entry.sizeBytes, chunkBytes };
      await fs.writeText(path(PARTIAL), JSON.stringify(part));
    }

    let cancelled = false;
    let active = null;
    current = { cancel() { cancelled = true; if (active) active.cancel(); } };
    let done = 0;
    for (let i = 0; i < n; i++) {
      const file = path(chunkName(part, i));
      const len = chunkLen(part, i);
      if ((await fs.exists(file)) && (await fs.size(file)) === len) {
        done += len;
        continue;
      }
      await fs.remove(file).catch(() => {});
      let lastErr = null;
      for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
        if (cancelled) fail({ cancelled: true });
        if (attempt > 0 && retryDelayMs) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        if (cancelled) fail({ cancelled: true });
        const start = i * chunkBytes;
        active = fs.downloadRange({ url: entry.url, to: file, start, end: start + len - 1, onProgress: (p) => report(done + (p.bytes || 0)) });
        try {
          const res = await active.done;
          if (res && res.status === 200 && i === 0 && (await fs.size(file)) === entry.sizeBytes) {
            // the server ignored the range and sent the whole map: that is the whole map
            await fs.move(file, tmp);
            await clearPartial();
            report(entry.sizeBytes);
            return undefined;
          }
          if (res && res.status === 200 && (await fs.size(file)) !== len) {
            // a server that cannot do partial downloads: fetch the whole map in one go instead
            await fs.remove(file).catch(() => {});
            return single();
          }
          if ((await fs.size(file)) !== len) throw new Error("the server did not honour a partial download");
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          await fs.remove(file).catch(() => {});
          if (err && err.cancelled) fail(err);
          if (err && err.fatal) break;
        }
      }
      if (lastErr) fail(lastErr);
      done += len;
      report(done);
    }

    // put the pieces together, removing each once it is in, so the phone never holds the map twice
    await fs.remove(tmp).catch(() => {});
    for (let i = 0; i < n; i++) {
      const file = path(chunkName(part, i));
      await fs.appendFrom(tmp, file);
      await fs.remove(file).catch(() => {});
    }
    await fs.remove(path(PARTIAL)).catch(() => {});
    return undefined;
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

    /** Publisher keys the backup key has told this phone to stop trusting. */
    async retiredKeys() {
      await store.init();
      return manifest.retired.slice();
    },

    async recordRetired(keys) {
      await store.init();
      const fresh = (keys || []).filter((k) => typeof k === "string" && !manifest.retired.includes(k));
      if (fresh.length) {
        manifest.retired = [...manifest.retired, ...fresh].slice(0, 32);
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
      if (current) throw new PackError("busy", t("Another map is already downloading."));
      if (!ID_PATTERN.test(entry.id)) throw new PackError("invalid", t("That map has an invalid name."));

      const tmp = path(`${entry.id}-v${entry.version}.part`);
      const final = path(fileFor(entry.id, entry.version));
      const cleanup = () => fs.remove(tmp).catch(() => {});
      try {
        const free = await fs.freeBytes().catch(() => Infinity);
        if (free < entry.sizeBytes + SPACE_MARGIN) {
          throw new PackError("no_space", t("Not enough free space on this phone (this map needs {size} MB).", { size: (entry.sizeBytes / 1048576).toFixed(1) }));
        }

        await cleanup();
        await fetchInto(entry, tmp, onProgress);

        if ((await fs.size(tmp)) !== entry.sizeBytes) {
          throw new PackError("size", t("The downloaded map is not the size it should be, so it was not used."));
        }
        if ((await fs.sha256(tmp)) !== entry.sha256) {
          throw new PackError("hash", t("The downloaded map does not match its checksum, so it was not used."));
        }

        let raw;
        try {
          raw = JSON.parse(await fs.readText(tmp));
        } catch {
          throw new PackError("invalid", t("The downloaded map could not be read, so it was not used."));
        }
        const loaded = loadPack(raw);
        if (!loaded.ok) throw new PackError("invalid", t("The downloaded map is not valid ({reason}), so it was not used.", { reason: loaded.error }));
        // the area the catalog (which is signed) promised must be the area the file really covers
        if (!sameBbox(raw.bbox, entry.bbox)) {
          throw new PackError("invalid", t("The downloaded map covers a different area than promised, so it was not used."));
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
          throw new PackError("storage", t("Could not save the map: {reason}", { reason: err.message }));
        }
        if (old && old.file !== manifest.packs[entry.id].file) await fs.remove(path(old.file)).catch(() => {});
        return manifest.packs[entry.id];
      } catch (err) {
        await cleanup();
        if (err instanceof PackError) throw err;
        throw new PackError("storage", t("Could not install the map: {reason}", { reason: err && err.message ? err.message : String(err) }));
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
      if (!entry) throw new PackError("invalid", t("That map is not installed."));
      const p = path(entry.file);
      if ((await fs.size(p)) !== entry.sizeBytes) throw new PackError("size", t("The saved map is damaged. Delete it and download it again."));
      try {
        return JSON.parse(await fs.readText(p));
      } catch {
        throw new PackError("invalid", t("The saved map is damaged. Delete it and download it again."));
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
