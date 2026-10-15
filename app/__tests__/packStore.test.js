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
