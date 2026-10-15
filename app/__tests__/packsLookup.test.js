const { findPackFor, listPacks, setInstalledSource } = require("../services/navigation/packs.js");
const { makePack } = require("./helpers/packs.js");

const lisbon = makePack({ nodes: [[38.70, -9.15], [38.71, -9.15], [38.71, -9.14]], edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }] });
const fake = (list, files) => ({ installed: async () => list, read: async (id) => files[id] });
const entry = { id: "lisbon", name: "Lisbon", version: 1, bbox: lisbon.bbox, sizeBytes: 1 };
const grambling = { latitude: 32.5266, longitude: -92.7165 };
const inLisbon = { latitude: 38.705, longitude: -9.145 };

test("bundled pack still covers Grambling", async () => {
  setInstalledSource(fake([], {}));
  const r = await findPackFor([grambling, { latitude: 32.527, longitude: -92.716 }]);
  expect(r.pack).not.toBeNull();
});
test("an installed pack covers its area; unreadable store falls back to bundled", async () => {
  setInstalledSource(fake([entry], { lisbon }));
  expect((await findPackFor([inLisbon, inLisbon])).pack.name).toBe("Test pack");
  setInstalledSource({ installed: async () => { throw new Error("boom"); }, read: async () => {} });
  expect((await findPackFor([grambling, grambling])).pack).not.toBeNull();
  expect((await findPackFor([inLisbon, inLisbon])).pack).toBeNull();
});
test("a damaged installed pack is skipped, not fatal; listPacks reports it", async () => {
  setInstalledSource({ installed: async () => [entry], read: async () => { throw new Error("damaged"); } });
  expect((await findPackFor([inLisbon, inLisbon])).pack).toBeNull();
  const l = await listPacks();
  expect(l.find((p) => p.id === "lisbon").error).toBeTruthy();
  expect(l.find((p) => p.id === "grambling-la").bundled).toBe(true);
});
test("an installed pack replaces a bundled one with the same id", async () => {
  setInstalledSource(fake([{ ...entry, id: "grambling-la", bbox: lisbon.bbox }], { "grambling-la": lisbon }));
  expect((await findPackFor([grambling, grambling])).pack).toBeNull();
});
test("partial coverage is reported", async () => {
  setInstalledSource(fake([entry], { lisbon }));
  const r = await findPackFor([inLisbon, grambling]);
  expect(r.pack).toBeNull();
  expect(r.partial).not.toBeNull();
});
