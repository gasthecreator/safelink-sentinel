const crypto = require("crypto");
const { createPackStore, PackError } = require("../services/maps/PackStore.js");
const { makePack } = require("./helpers/packs.js");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function fakeFs({ free = 1e9 } = {}) {
  const files = new Map();
  const fs = {
    root: "/maps",
    files,
    served: {}, // url -> text
    failWrite: null,
    freeSpace: free,
    hold: null, // promise to await during a download
    exists: async (p) => files.has(p) || p === "/maps",
    mkdirp: async () => {},
    readText: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
    writeText: async (p, t) => { if (fs.failWrite && p.endsWith(fs.failWrite)) throw new Error("disk full"); files.set(p, t); },
    move: async (a, b) => { if (!files.has(a)) throw new Error("ENOENT"); files.set(b, files.get(a)); files.delete(a); },
    remove: async (p) => { files.delete(p); },
    list: async () => [...files.keys()].map((k) => k.slice(6)),
    size: async (p) => Buffer.byteLength(files.get(p)),
    sha256: async (p) => sha(files.get(p)),
    freeBytes: async () => fs.freeSpace,
    download({ url, to, onProgress }) {
      let cancelled = false;
      const done = (async () => {
        if (fs.hold) await fs.hold;
        if (cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
        if (!(url in fs.served)) throw new Error("the server answered 404");
        files.set(to, fs.served[url]);
        onProgress && onProgress({ bytes: 1, total: 1 });
      })();
      return { done, cancel() { cancelled = true; } };
    },
  };
  return fs;
}

const pack = makePack({ nodes: [[32.52, -92.71], [32.53, -92.71], [32.53, -92.70]], edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }] });
const text = JSON.stringify(pack);
const entryFor = (over = {}) => ({
  id: "test-area", name: "Test area", version: 1, bbox: pack.bbox, sizeBytes: Buffer.byteLength(text),
  sha256: sha(text), url: "https://x/test-area-v1.json", builtAt: "2026-01-01", attribution: "OSM", ...over,
});
const setup = (opts) => { const fs = fakeFs(opts); const store = createPackStore(() => fs); return { fs, store }; };

test("installs a valid pack and lists it", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  const progress = [];
  const e = await store.install(entryFor(), { onProgress: (p) => progress.push(p) });
  expect(e.file).toBe("test-area-v1.json");
  expect((await store.installed()).map((p) => p.id)).toEqual(["test-area"]);
  expect((await store.read("test-area")).format).toBe(1);
  expect(progress.length).toBe(1);
  expect([...fs.files.keys()].some((k) => k.endsWith(".part"))).toBe(false);
});

test("survives restart (manifest reloaded)", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await store.install(entryFor());
  await store.recordSequence(7);
  const again = createPackStore(() => fs);
  expect((await again.installed()).length).toBe(1);
  expect(await again.lastSequence()).toBe(7);
});

test("sequence only moves forward", async () => {
  const { store } = setup();
  await store.recordSequence(5);
  await store.recordSequence(3);
  expect(await store.lastSequence()).toBe(5);
});

test.each([
  ["wrong checksum", { sha256: "0".repeat(64) }, "hash"],
  ["wrong size", { sizeBytes: 10 }, "size"],
  ["bbox mismatch", { bbox: [0, 0, 1, 1] }, "invalid"],
])("rejects %s and leaves nothing behind", async (_n, over, code) => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await expect(store.install(entryFor(over))).rejects.toMatchObject({ code });
  expect(await store.installed()).toEqual([]);
  expect([...fs.files.keys()]).toEqual([]);
});

test("rejects non-JSON and invalid pack bodies even with matching hash", async () => {
  for (const body of ["not json", JSON.stringify({ format: 1, nodes: [] })]) {
    const { fs, store } = setup();
    fs.served["https://x/test-area-v1.json"] = body;
    await expect(store.install(entryFor({ sizeBytes: Buffer.byteLength(body), sha256: sha(body) }))).rejects.toMatchObject({ code: "invalid" });
    expect(await store.installed()).toEqual([]);
  }
});

test("download failure and unknown ids are reported", async () => {
  const { store } = setup();
  await expect(store.install(entryFor())).rejects.toMatchObject({ code: "download" });
  await expect(store.install(entryFor({ id: "../evil" }))).rejects.toMatchObject({ code: "invalid" });
});

test("refuses when there is not enough space", async () => {
  const { fs, store } = setup({ free: 100 });
  fs.served["https://x/test-area-v1.json"] = text;
  await expect(store.install(entryFor())).rejects.toMatchObject({ code: "no_space" });
});

test("update replaces old version only after the new one is in place", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await store.install(entryFor());
  const text2 = JSON.stringify({ ...pack, name: "v2" });
  fs.served["https://x/test-area-v2.json"] = text2;
  await store.install(entryFor({ version: 2, url: "https://x/test-area-v2.json", sizeBytes: Buffer.byteLength(text2), sha256: sha(text2) }));
  expect([...fs.files.keys()].sort()).toEqual(["/maps/manifest.json", "/maps/test-area-v2.json"]);
  expect((await store.installed())[0].version).toBe(2);
});

test("a failed update keeps the old version working", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await store.install(entryFor());
  fs.served["https://x/test-area-v2.json"] = text;
  await expect(store.install(entryFor({ version: 2, url: "https://x/test-area-v2.json", sha256: "1".repeat(64) }))).rejects.toMatchObject({ code: "hash" });
  expect((await store.installed())[0].version).toBe(1);
  expect((await store.read("test-area")).format).toBe(1);
});

test("manifest write failure rolls back to the previous state", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await store.init();
  fs.failWrite = "manifest.tmp";
  await expect(store.install(entryFor())).rejects.toMatchObject({ code: "storage" });
  expect(await store.installed()).toEqual([]);
  expect([...fs.files.keys()]).toEqual([]);
});

test("only one download at a time; cancel stops it cleanly", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  let release;
  fs.hold = new Promise((r) => { release = r; });
  const first = store.install(entryFor());
  await new Promise((r) => setImmediate(r));
  expect(store.busy).toBe(true);
  await expect(store.install(entryFor())).rejects.toMatchObject({ code: "busy" });
  store.cancel();
  release();
  await expect(first).rejects.toMatchObject({ code: "cancelled" });
  expect(store.busy).toBe(false);
  expect(await store.installed()).toEqual([]);
  expect([...fs.files.keys()]).toEqual([]);
});

test("startup removes leftovers and drops manifest entries whose file vanished", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await store.install(entryFor());
  fs.files.set("/maps/junk-v1.part", "x");
  fs.files.delete("/maps/test-area-v1.json");
  const again = createPackStore(() => fs);
  expect(await again.installed()).toEqual([]);
  expect(fs.files.has("/maps/junk-v1.part")).toBe(false);
});

test("tampered manifest entries (path tricks) are ignored", async () => {
  const fs = fakeFs();
  fs.files.set("/maps/manifest.json", JSON.stringify({ format: 1, lastSequence: 2, packs: {
    "../x": { id: "../x", name: "x", version: 1, file: "../x-v1.json", sizeBytes: 1 },
    ok: { id: "ok", name: "ok", version: 1, file: "../../etc/passwd", sizeBytes: 1 },
  } }));
  const store = createPackStore(() => fs);
  expect(await store.installed()).toEqual([]);
  expect(await store.lastSequence()).toBe(2);
});

test("remove forgets then deletes; read detects damage", async () => {
  const { fs, store } = setup();
  fs.served["https://x/test-area-v1.json"] = text;
  await store.install(entryFor());
  fs.files.set("/maps/test-area-v1.json", "corrupt");
  await expect(store.read("test-area")).rejects.toMatchObject({ code: "size" });
  expect(await store.remove("test-area")).toBe(true);
  expect(await store.remove("test-area")).toBe(false);
  expect(fs.files.has("/maps/test-area-v1.json")).toBe(false);
});

// ---- catalog fetching ----
const nacl = require("tweetnacl");
const { fetchCatalog, describeCatalog } = require("../services/maps/MapCatalog.js");
const signer = require("../scripts/lib/catalogSigner.js");

describe("fetchCatalog", () => {
  const kp = signer.generateKeypair();
  const make = (n) => JSON.stringify(signer.signCatalog({ sequence: n, generatedAt: new Date().toISOString(), packs: [entryFor()] }, kp.secretKey));
  const respond = (body, over = {}) => async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body, ...over });
  const opts = (fetchImpl) => ({ fetchImpl, url: "https://x/catalog.json", publicKey: kp.publicKey });

  test("verifies, returns packs and remembers the sequence", async () => {
    const { store } = setup();
    const c = await fetchCatalog(store, opts(respond(make(4))));
    expect(c.packs[0].id).toBe("test-area");
    expect(await store.lastSequence()).toBe(4);
  });
  test("an older catalog is refused after a newer one was seen", async () => {
    const { store } = setup();
    await fetchCatalog(store, opts(respond(make(4))));
    await expect(fetchCatalog(store, opts(respond(make(3))))).rejects.toMatchObject({ code: "stale" });
  });
  test("a forged catalog is refused and the sequence is not recorded", async () => {
    const { store } = setup();
    const other = signer.generateKeypair();
    const forged = JSON.stringify(signer.signCatalog({ sequence: 99, generatedAt: new Date().toISOString(), packs: [] }, other.secretKey));
    await expect(fetchCatalog(store, opts(respond(forged)))).rejects.toBeInstanceOf(Error);
    expect(await store.lastSequence()).toBe(0);
  });
  test("disabled with no key; network and http errors are CatalogErrors", async () => {
    const { store } = setup();
    await expect(fetchCatalog(store, { ...opts(respond(make(1))), publicKey: "" })).rejects.toMatchObject({ code: "disabled" });
    await expect(fetchCatalog(store, opts(async () => { throw new Error("offline"); }))).rejects.toMatchObject({ code: "network" });
    await expect(fetchCatalog(store, opts(respond("", { ok: false, status: 404 })))).rejects.toMatchObject({ code: "network" });
    await expect(fetchCatalog(store, opts(respond("not json")))).rejects.toMatchObject({ code: "invalid" });
    await expect(fetchCatalog(store, { ...opts(respond(make(1))), url: "http://x/c.json" })).rejects.toMatchObject({ code: "invalid" });
    await expect(fetchCatalog(store, opts(respond("{}", { headers: { get: () => "99999999" } })))).rejects.toMatchObject({ code: "too_large" });
  });
  test("describeCatalog marks new / update / installed", () => {
    const cat = { packs: [entryFor({ id: "a" }), entryFor({ id: "b", version: 2 }), entryFor({ id: "c" })] };
    const out = describeCatalog(cat, [{ id: "b", version: 1 }, { id: "c", version: 1 }]);
    expect(out.map((o) => o.status)).toEqual(["new", "update", "installed"]);
  });
});

describe("shipped configuration", () => {
  const cfg = require("../constants/maps.js");
  test("cleartext downloads are never enabled in a committed build", () => {
    expect(cfg.ALLOW_INSECURE_PACK_URLS).toBe(false);
    expect(cfg.MAP_CATALOG_URL.startsWith("https://")).toBe(true);
  });
  test("the publisher key is either empty (downloads off) or a valid 32-byte key", () => {
    if (cfg.MAP_CATALOG_PUBLIC_KEY) expect(Buffer.from(cfg.MAP_CATALOG_PUBLIC_KEY, "base64").length).toBe(32);
  });
});

// ---- resumable (chunked) downloads ----
describe("resumable downloads", () => {
  const big = JSON.stringify({ ...pack, name: "x".repeat(300) }); // a few hundred bytes: many tiny chunks
  const bigEntry = (over = {}) => ({
    ...entryFor(), sizeBytes: Buffer.byteLength(big), sha256: sha(big), url: "https://x/big.json", ...over,
  });

  function rangeFs(opts) {
    const fs = fakeFs(opts);
    fs.served["https://x/big.json"] = big;
    fs.rangeCalls = [];
    fs.failRangeAt = null; // chunk start offsets that fail once each
    fs.rangeMode = "206"; // or "200" (server ignores Range)
    fs.corruptStart = null;
    fs.appendFrom = async (dest, src) => { fs.files.set(dest, (fs.files.get(dest) || "") + fs.files.get(src)); };
    fs.downloadRange = ({ url, to, start, end, onProgress }) => {
      let cancelled = false;
      fs.rangeCalls.push([start, end]);
      const done = (async () => {
        await Promise.resolve();
        if (fs.hold) await fs.hold;
        if (cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
        if (fs.failRangeAt && fs.failRangeAt.has(start)) { fs.failRangeAt.delete(start); throw new Error("connection lost"); }
        const body = Buffer.from(fs.served[url]);
        if (fs.rangeMode === "200") { fs.files.set(to, fs.served[url]); return { status: 200 }; }
        let piece = body.subarray(start, end + 1).toString();
        if (fs.corruptStart === start) piece = piece.replace(/./, "#");
        fs.files.set(to, piece);
        onProgress && onProgress({ bytes: piece.length });
        return { status: 206 };
      })();
      return { done, cancel() { cancelled = true; } };
    };
    return fs;
  }
  const mk = (fs) => createPackStore(() => fs, { chunkBytes: 100, retryDelayMs: 0 });

  test("downloads in pieces, assembles, installs, leaves no pieces behind", async () => {
    const fs = rangeFs();
    const store = mk(fs);
    const prog = [];
    await store.install(bigEntry(), { onProgress: (p) => prog.push(p.bytes) });
    expect(fs.rangeCalls.length).toBe(Math.ceil(Buffer.byteLength(big) / 100));
    expect((await store.read("test-area")).format).toBe(1);
    expect([...fs.files.keys()].sort()).toEqual(["/maps/manifest.json", "/maps/test-area-v1.json"]);
    expect(prog[prog.length - 1]).toBe(Buffer.byteLength(big));
    expect([...prog].sort((a, b) => a - b)).toEqual(prog); // never goes backwards
  });

  test("a dropped connection is retried and the download still completes", async () => {
    const fs = rangeFs();
    fs.failRangeAt = new Set([100, 200]);
    const store = mk(fs);
    await store.install(bigEntry());
    expect((await store.installed()).length).toBe(1);
  });

  test("cancel keeps finished pieces; a later install resumes without re-fetching them", async () => {
    const fs = rangeFs();
    const store = mk(fs);
    // fail a late chunk permanently the first time (more failures than retries)
    const total = Math.ceil(Buffer.byteLength(big) / 100);
    const lateStart = (total - 1) * 100;
    let n = 0;
    const orig = fs.downloadRange;
    fs.downloadRange = (a) => (a.start === lateStart && n++ < 10 ? { done: Promise.reject(new Error("offline")), cancel() {} } : orig(a));
    await expect(store.install(bigEntry())).rejects.toMatchObject({ code: "download" });
    expect(await store.installed()).toEqual([]);
    const kept = [...fs.files.keys()].filter((k) => /\.c\d+$/.test(k));
    expect(kept.length).toBe(total - 1);
    fs.rangeCalls.length = 0;
    fs.downloadRange = orig;
    // "restart" the app, then try again
    const again = mk(fs);
    await again.install(bigEntry());
    expect(fs.rangeCalls).toEqual([[lateStart, Buffer.byteLength(big) - 1]]); // only the missing piece
    expect((await again.installed()).length).toBe(1);
    expect([...fs.files.keys()].some((k) => k.endsWith(".c0") || k.endsWith("partial.json"))).toBe(false);
  });

  test("a different map (or version) never reuses another download's pieces", async () => {
    const fs = rangeFs();
    const store = mk(fs);
    const orig = fs.downloadRange;
    fs.downloadRange = (a) => (a.start >= 200 ? { done: Promise.reject(new Error("offline")), cancel() {} } : orig(a));
    await expect(store.install(bigEntry())).rejects.toMatchObject({ code: "download" });
    fs.downloadRange = orig;
    fs.rangeCalls.length = 0;
    fs.served["https://x/big2.json"] = big;
    await store.install(bigEntry({ version: 2, url: "https://x/big2.json" }));
    expect(fs.rangeCalls[0][0]).toBe(0); // started from the beginning
    expect(fs.rangeCalls.length).toBe(Math.ceil(Buffer.byteLength(big) / 100));
  });

  test("a corrupt piece fails the checksum, and its pieces are discarded", async () => {
    const fs = rangeFs();
    fs.corruptStart = 100;
    const store = mk(fs);
    await expect(store.install(bigEntry())).rejects.toMatchObject({ code: "hash" });
    expect([...fs.files.keys()]).toEqual([]);
    fs.corruptStart = null;
    await store.install(bigEntry());
    expect((await store.installed()).length).toBe(1);
  });

  test("a server that ignores Range still works (whole file in one go)", async () => {
    const fs = rangeFs();
    fs.rangeMode = "200";
    const store = mk(fs);
    await store.install(bigEntry());
    expect(fs.rangeCalls.length).toBe(1);
    expect((await store.installed()).length).toBe(1);
    expect([...fs.files.keys()].sort()).toEqual(["/maps/manifest.json", "/maps/test-area-v1.json"]);
  });

  test("cancel mid-download stops, reports cancelled, keeps pieces for resume", async () => {
    const fs = rangeFs();
    const store = mk(fs);
    let release;
    fs.hold = new Promise((r) => { release = r; });
    const p = store.install(bigEntry());
    await new Promise((r) => setImmediate(r));
    store.cancel();
    release();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
    expect(store.busy).toBe(false);
    fs.hold = null;
    await store.install(bigEntry());
    expect((await store.installed()).length).toBe(1);
  });
});

// ---- maps near you ----
describe("ranking maps by where you are", () => {
  const { rankByPosition, distanceToBboxM } = require("../services/maps/MapCatalog.js");
  const mk = (id, bbox) => ({ entry: { id, bbox }, status: "new" });
  const grambling = mk("grambling", [32.48, -92.76, 32.58, -92.60]);
  const dallas = mk("dallas", [32.60, -97.10, 32.95, -96.55]);
  const lisbon = mk("lisbon", [38.6, -9.3, 38.8, -9.0]);
  const here = { latitude: 32.5266, longitude: -92.7165 };

  test("inside a map is distance 0; outside is the distance to its nearest edge", () => {
    expect(distanceToBboxM(here, grambling.entry.bbox)).toBe(0);
    // 0.1 degree of latitude north of a map's top edge is about 11.1 km
    expect(Math.round(distanceToBboxM({ latitude: 32.68, longitude: -92.7 }, grambling.entry.bbox) / 100)).toBe(Math.round(11132 / 100));
    // west of the edge: shrinks with latitude (cos), here about 0.1 deg * 111.3 km * cos(32.5)
    const west = distanceToBboxM({ latitude: 32.5, longitude: -92.86 }, grambling.entry.bbox);
    expect(west).toBeGreaterThan(9000);
    expect(west).toBeLessThan(9700);
  });
  test("the map covering you comes first, then the nearest", () => {
    const ranked = rankByPosition([lisbon, dallas, grambling], here);
    expect(ranked.map((o) => o.entry.id)).toEqual(["grambling", "dallas", "lisbon"]);
    expect(ranked[0].coversYou).toBe(true);
    expect(ranked[1].coversYou).toBe(false);
    expect(ranked[1].distanceM).toBeGreaterThan(0);
  });
  test("without a usable position the order is left alone", () => {
    const list = [lisbon, dallas, grambling];
    expect(rankByPosition(list, null)).toBe(list);
    expect(rankByPosition(list, { latitude: NaN, longitude: 1 })).toBe(list);
  });
  test("a position on a map's edge counts as covered", () => {
    expect(distanceToBboxM({ latitude: 32.48, longitude: -92.7 }, grambling.entry.bbox)).toBe(0);
  });
});

// ---- backup key and key retirement ----
describe("backup publisher key", () => {
  const { verifyCatalog } = require("../services/maps/catalog.js");
  const primary = signer.generateKeypair();
  const backup = signer.generateKeypair();
  const thief = signer.generateKeypair();
  const body = (n, extra = {}) => ({ sequence: n, generatedAt: new Date().toISOString(), packs: [entryFor()], ...extra });
  const signed = (b, kp) => signer.signCatalog(b, kp.secretKey);
  const opts = (over = {}) => ({ publicKey: primary.publicKey, backupPublicKey: backup.publicKey, ...over });

  test("either key can sign a catalog, and the result says which", () => {
    expect(verifyCatalog(signed(body(1), primary), opts()).signedBy).toBe("primary");
    expect(verifyCatalog(signed(body(1), backup), opts()).signedBy).toBe("backup");
  });
  test("a key that is not one of the two is refused", () => {
    expect(() => verifyCatalog(signed(body(1), thief), opts())).toThrow(/signature/);
  });
  test("with no backup configured only the primary works", () => {
    expect(() => verifyCatalog(signed(body(1), backup), { publicKey: primary.publicKey })).toThrow(/signature/);
  });
  test("the backup can retire the primary; the primary cannot retire anything", () => {
    const fromBackup = verifyCatalog(signed(body(5, { retire: [primary.publicKey] }), backup), opts());
    expect(fromBackup.retire).toEqual([primary.publicKey]);
    const fromPrimary = verifyCatalog(signed(body(5, { retire: [thief.publicKey, backup.publicKey] }), primary), opts());
    expect(fromPrimary.retire).toEqual([]);
  });
  test("the backup cannot retire itself, and junk entries are ignored", () => {
    const r = verifyCatalog(signed(body(5, { retire: [backup.publicKey, "nonsense", 42, primary.publicKey, primary.publicKey] }), backup), opts());
    expect(r.retire).toEqual([primary.publicKey]);
  });
  test("once the primary is retired, catalogs signed with it are refused", () => {
    const opt = opts({ retiredKeys: [primary.publicKey] });
    expect(() => verifyCatalog(signed(body(9), primary), opt)).toThrow(/signature/);
    expect(verifyCatalog(signed(body(9), backup), opt).signedBy).toBe("backup");
  });
  test("with every key retired nothing is trusted", () => {
    expect(() => verifyCatalog(signed(body(1), backup), opts({ retiredKeys: [primary.publicKey, backup.publicKey] }))).toThrow(/Update the app/);
  });

  test("end to end: a leaked primary is locked out for good once the backup's catalog is seen", async () => {
    const { fs, store } = setup();
    const o = { fetchImpl: null, url: "https://x/catalog.json", publicKey: primary.publicKey, backupPublicKey: backup.publicKey };
    const serve = (kp, n, extra) => ({ ...o, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(signed(body(n, extra), kp)) }) });
    await fetchCatalog(store, serve(primary, 3)); // normal life
    await fetchCatalog(store, serve(backup, 1003, { retire: [primary.publicKey] })); // the backup steps in, far ahead
    expect(await store.retiredKeys()).toEqual([primary.publicKey]);
    // the thief, holding the primary, publishes something even newer: refused
    await expect(fetchCatalog(store, serve(primary, 5000))).rejects.toMatchObject({ code: "bad_signature" });
    // and the decision survives an app restart
    const again = createPackStore(() => fs);
    expect(await again.retiredKeys()).toEqual([primary.publicKey]);
    await expect(fetchCatalog(again, serve(primary, 9000))).rejects.toMatchObject({ code: "bad_signature" });
  });

  test("a stale thief catalog cannot out-run the retirement because retire sticks even though sequences moved", async () => {
    const { store } = setup();
    const base = { url: "https://x/catalog.json", publicKey: primary.publicKey, backupPublicKey: backup.publicKey };
    const serve = (kp, n, extra) => ({ ...base, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(signed(body(n, extra), kp)) }) });
    await fetchCatalog(store, serve(primary, 2000)); // thief got to 2000 first
    await fetchCatalog(store, serve(backup, 2001, { retire: [primary.publicKey] }));
    await expect(fetchCatalog(store, serve(primary, 9999))).rejects.toMatchObject({ code: "bad_signature" });
  });

  test("the publisher tools: --retire needs a sequence jump and puts the key in the signed body", () => {
    const b = signer.buildBody({ previous: { sequence: 7, packs: [] }, packs: [], baseUrl: "https://x", retire: [primary.publicKey], minSequence: 1007 });
    expect(b.sequence).toBe(1007);
    expect(b.retire).toEqual([primary.publicKey]);
    expect(signer.buildBody({ previous: { sequence: 7, packs: [] }, packs: [], baseUrl: "https://x" }).sequence).toBe(8);
    expect(signer.buildBody({ previous: { sequence: 7, packs: [] }, packs: [], baseUrl: "https://x" }).retire).toBeUndefined();
  });
});
