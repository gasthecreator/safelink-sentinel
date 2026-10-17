const { createNetwork, boot, discover, settle } = require("./helpers/meshHarness");
const { eraseMyData, PERSONAL_KEYS } = require("../services/privacy/DataWipe.js");

let net;
beforeEach(() => {
  net = createNetwork();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, removeItem: async (k) => { delete data[k]; }, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => { data[k] = v; } };
};

describe("what is erased and what is kept", () => {
  test("personal keys go; settings, onboarding and the maps stay", async () => {
    const initial = {};
    for (const k of PERSONAL_KEYS) initial[k] = "something personal";
    Object.assign(initial, { "@safelink_units": "imperial", "@safelink_voice": "0", hasSeenOnboarding: "true", "@safelink_map_manifest": "maps" });
    const storage = memoryStorage(initial);
    const result = await eraseMyData({ storage, modules: {} });
    expect(result).toEqual({ removedKeys: PERSONAL_KEYS.length, failures: [], identityReset: false });
    expect(Object.keys(storage.data).sort()).toEqual(["@safelink_map_manifest", "@safelink_units", "@safelink_voice", "hasSeenOnboarding"]);
  });

  test("a step that fails does not stop the rest, and is reported", async () => {
    const storage = memoryStorage({ "@safelink_places": "x", "@safelink_outbox": "y" });
    const calls = [];
    const modules = {
      relay: { reset: () => { throw new Error("boom"); } },
      alerts: { reset: () => calls.push("alerts") },
      roads: { clear: async () => calls.push("roads") },
    };
    const result = await eraseMyData({ storage, modules });
    expect(calls).toEqual(["alerts", "roads"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/messages in memory: boom/);
    expect(storage.data).toEqual({});
  });

  test("a storage key that cannot be removed is reported, the others still go", async () => {
    const storage = memoryStorage({ "@safelink_places": "x", "@safelink_outbox": "y" });
    const real = storage.removeItem;
    storage.removeItem = async (k) => { if (k === "@safelink_places") throw new Error("disk"); return real(k); };
    const result = await eraseMyData({ storage, modules: {} });
    expect(result.failures).toEqual(["stored @safelink_places: disk"]);
    expect(storage.data).toEqual({ "@safelink_places": "x" });
  });
});

describe("identity", () => {
  test("kept by default; reset only when asked, and the radio re-advertises afterwards", async () => {
    const log = [];
    const modules = { identity: { reset: async () => log.push("identity") }, transport: { stop: async () => log.push("stop"), start: async () => log.push("start") } };
    await eraseMyData({ storage: memoryStorage(), modules });
    expect(log).toEqual([]);
    const result = await eraseMyData({ storage: memoryStorage(), modules, resetIdentity: true });
    expect(log).toEqual(["identity", "stop", "start"]);
    expect(result.identityReset).toBe(true);
  });
  test("if the identity could not be reset, the radio is not restarted and it is said", async () => {
    const log = [];
    const modules = { identity: { reset: async () => { throw new Error("keychain locked"); } }, transport: { stop: async () => log.push("stop"), start: async () => log.push("start") } };
    const result = await eraseMyData({ storage: memoryStorage(), modules, resetIdentity: true });
    expect(log).toEqual([]);
    expect(result.identityReset).toBe(false);
    expect(result.failures).toEqual(["identity: keychain locked"]);
  });
});

describe("the real stores, end to end", () => {
  async function phoneWithData() {
    const me = await boot(net, "me");
    const other = await boot(net, "other");
    const third = await boot(net, "third");
    await discover(net, me, other);
    // an alert I sent and one I received and one I am relaying; a place; a road report; a relief request
    await me.geo.broadcast(me.id, "my own alert", { priority: "high" });
    await me.outbox.flush();
    await me.relay.receive(Buffer.from(JSON.stringify(await third.Env.createEnvelope({ id: "a1", content: "Water at the school", meta: { priority: "high" }, ttl: 4 })), "utf8"));
    await settle();
    await me.roads.publish({ kind: "blocked", position: { latitude: 32.52, longitude: -92.71 }, note: "tree" });
    me.store["@safelink_places"] = JSON.stringify([{ id: "p", name: "Home", latitude: 1, longitude: 2 }]);
    await me.alerts.createReliefRequestAndAlert(me.id, { type: "water", description: "need water", location: null }).catch(() => {});
    return me;
  }
  const modulesOf = (me) => ({ relay: me.relay, outbox: me.outbox, alerts: me.alerts, roads: me.roads, identity: me.Id, reliefStore: require("../services/storage/ReliefRequestStore.js").default });

  test("after erasing, nothing personal is left in memory or storage, and nothing comes back", async () => {
    const me = await phoneWithData();
    expect((await me.alerts.getAlertFeed()).length).toBeGreaterThan(0);
    expect(me.outbox.getStats().total).toBeGreaterThan(0);
    expect(me.roads.list().length).toBeGreaterThan(0);

    const result = await eraseMyData({ storage: { removeItem: async (k) => { delete me.store[k]; } }, modules: { relay: me.relay, outbox: me.outbox, alerts: me.alerts, roads: me.roads } });
    expect(result.failures).toEqual([]);

    // memory
    expect(me.outbox.getStats().total).toBe(0);
    expect(me.relay.seen.size).toBe(0);
    expect(me.roads.list()).toEqual([]);
    expect(me.alerts.incomingAlerts).toEqual([]);
    // storage
    for (const key of PERSONAL_KEYS) expect(me.store[key]).toBeUndefined();
    // a save that was already queued must not put the old data back
    await me.outbox.persist();
    expect(JSON.parse(me.store["@safelink_outbox"] || "[]")).toEqual([]);
  });

  test("an identity reset gives a new device id, and signing keeps working", async () => {
    const me = await phoneWithData();
    const oldId = me.id;
    await eraseMyData({ resetIdentity: true, storage: { removeItem: async (k) => { delete me.store[k]; } }, modules: { identity: me.Id } });
    const newId = await me.Id.getDeviceId();
    expect(newId).not.toBe(oldId);
    const env = await me.Env.createEnvelope({ id: "after", content: "still works", ttl: 2 });
    expect(env.from).toBe(newId);
    expect(me.Env.verifyEnvelope(env)).toBe(true);
  });
});
