const { createNetwork, boot, discover, settle } = require("./helpers/meshHarness");
const { MAX_PER_SENDER, MAX_TOTAL } = require("../services/roads/reports.js");

let net;
beforeEach(() => {
  net = createNetwork();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const here = { latitude: 32.52, longitude: -92.72, accuracyM: 6 };
const stored = (store) => JSON.parse(store["@safelink_road_reports"] || "[]");
const goodReport = (over = {}) => ({
  id: `id-${Math.random().toString(36).slice(2)}`, kind: "blocked", latitude: 32.52, longitude: -92.72, accuracyM: 5,
  note: null, senderId: "someone", reportedAt: Date.now() - 1000, ...over,
});

test("publishing a report keeps it locally, so our own routes respect it", async () => {
  const alice = await boot(net, "alice");
  await alice.roads.publish({ kind: "blocked", position: here, note: "tree down" });
  expect(alice.roads.list()).toHaveLength(1);
  expect(alice.roads.closures()).toEqual([expect.objectContaining({ kind: "blocked", note: "tree down" })]);
  expect(stored(alice.store)).toHaveLength(1);
});

test("a published report reaches a nearby phone, and is not mistaken for an alert", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  await discover(net, alice, bob);
  await alice.roads.publish({ kind: "blocked", position: here, note: "bridge out" });

  expect(bob.roads.closures()).toEqual([expect.objectContaining({ kind: "blocked", note: "bridge out", latitude: 32.52 })]);
  expect(await bob.alerts.getAlertFeed()).toEqual([]); // it's a road report, not an alert
  // and the sender of it is who really sent it
  expect(bob.roads.list()[0].senderId).toBe(alice.id);
});

test("it is relayed and kept for a phone that arrives later, like an alert", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  const carol = await boot(net, "carol");
  await discover(net, alice, bob);
  await alice.roads.publish({ kind: "blocked", position: here });
  net.unlink(alice.id, bob.id);
  await discover(net, bob, carol);
  await bob.outbox.flush();
  await settle();
  expect(carol.roads.closures()).toHaveLength(1);
});

test("the same report heard twice is stored once", async () => {
  const alice = await boot(net, "alice");
  const r = goodReport({ id: "same" });
  expect(await alice.roads.add(r)).toBe(true);
  expect(await alice.roads.add(r)).toBe(false);
  expect(alice.roads.list()).toHaveLength(1);
});

test("reports survive an app restart", async () => {
  const phoneStore = {};
  const first = await boot(net, "alice", phoneStore);
  await first.roads.publish({ kind: "hazard", position: here, note: "flooding" });
  net.devices.delete(first.id);
  const second = await boot(net, "alice", phoneStore);
  await second.roads.init();
  expect(second.roads.list().map((r) => r.note)).toEqual(["flooding"]);
});

describe("hostile or broken input", () => {
  const msg = (over = {}) => ({
    id: "m1", from: "mallory", type: "broadcast", sentAt: new Date().toISOString(),
    meta: { type: "road_report", kind: "blocked", position: { ...here }, note: "x" }, ...over,
  });
  test.each([
    ["not a road report", { meta: { type: "alert", kind: "blocked", position: here } }],
    ["a direct (not broadcast) message", { type: "direct" }],
    ["an unknown kind", { meta: { type: "road_report", kind: "explosion", position: here } }],
    ["no position", { meta: { type: "road_report", kind: "blocked" } }],
    ["an impossible position", { meta: { type: "road_report", kind: "blocked", position: { latitude: 999, longitude: 0 } } }],
    ["a time in the far future", { sentAt: new Date(Date.now() + 86400000).toISOString() }],
    ["an unreadable time", { sentAt: "yesterday-ish" }],
    ["no meta at all", { meta: undefined }],
  ])("%s is ignored", async (_n, over) => {
    const bob = await boot(net, "bob");
    expect(await bob.roads.handleIncoming(msg(over))).toBe(false);
    expect(bob.roads.list()).toEqual([]);
  });
  test("a valid one is accepted", async () => {
    const bob = await boot(net, "bob");
    expect(await bob.roads.handleIncoming(msg())).toBe(true);
    expect(bob.roads.list()).toHaveLength(1);
  });
  test("publishing an invalid report throws a readable error and sends nothing", async () => {
    const alice = await boot(net, "alice");
    await expect(alice.roads.publish({ kind: "blocked", position: { latitude: 999, longitude: 0 } })).rejects.toThrow(/isn't valid/);
    await expect(alice.roads.publish({ kind: "nope", position: here })).rejects.toThrow(/isn't valid/);
    expect(alice.outbox.getStats().total).toBe(0);
  });
  test("corrupt saved data is dropped entry by entry, not fatal", async () => {
    const phoneStore = { "@safelink_road_reports": JSON.stringify([goodReport({ id: "ok" }), { id: "bad", kind: "x" }, "junk", null, goodReport({ id: "ok" })]) };
    const a = await boot(net, "alice", phoneStore);
    await a.roads.init();
    expect(a.roads.list().map((r) => r.id)).toEqual(["ok"]); // bad entries and the duplicate are gone
    const b = await boot(net, "bob", { "@safelink_road_reports": "{not json" });
    await b.roads.init();
    expect(b.roads.list()).toEqual([]);
  });
});

describe("one phone cannot flood the store", () => {
  test("only the newest reports from any single phone are kept", async () => {
    const a = await boot(net, "alice");
    const now = Date.now();
    for (let i = 0; i < MAX_PER_SENDER + 25; i++) {
      await a.roads.add(goodReport({ id: `spam-${i}`, senderId: "spammer", reportedAt: now - 60000 + i, latitude: 32.5 + i * 0.001 }));
    }
    const kept = a.roads.list().filter((r) => r.senderId === "spammer");
    expect(kept).toHaveLength(MAX_PER_SENDER);
    expect(kept.some((r) => r.id === `spam-${MAX_PER_SENDER + 24}`)).toBe(true); // newest survived
    expect(kept.some((r) => r.id === "spam-0")).toBe(false); // oldest went
  });
  test("a flood does not push out other people's reports", async () => {
    const a = await boot(net, "alice");
    const now = Date.now();
    await a.roads.add(goodReport({ id: "honest", senderId: "carol", reportedAt: now - 120000 }));
    for (let i = 0; i < 200; i++) await a.roads.add(goodReport({ id: `s${i}`, senderId: "spammer", reportedAt: now - i }));
    expect(a.roads.list().some((r) => r.id === "honest")).toBe(true);
  });
  test("there is an overall cap too", async () => {
    const a = await boot(net, "alice");
    const now = Date.now();
    for (let i = 0; i < MAX_TOTAL + 40; i++) {
      await a.roads.add(goodReport({ id: `m${i}`, senderId: `phone-${i % 40}`, reportedAt: now - 100000 + i }));
    }
    expect(a.roads.list().length).toBeLessThanOrEqual(MAX_TOTAL);
  });
});
