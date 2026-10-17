// What NodeDiscovery and MessageRelay do with the answer: a device that cannot prove it is Bob cannot take over
// Bob's entry, and a direct message for Bob is never handed to it.

function loadDiscovery(profiles) {
  let nd;
  let store = {};
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({
      Platform: { OS: "android", Version: 30 },
      PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {}, request: async () => "granted", requestMultiple: async () => ({}) },
      NativeModules: {},
      NativeEventEmitter: class { addListener() { return { remove() {} }; } },
    }));
    jest.doMock("../services/ble/bleManager.js", () => ({ getBleManager: () => ({}) }));
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: {
        getItem: async (k) => store[k] ?? null,
        setItem: async (k, v) => { store[k] = v; },
        removeItem: async (k) => { delete store[k]; },
      },
    }));
    jest.doMock("../services/ble/BleTransport.js", () => ({
      __esModule: true,
      default: { readProfile: async (bleId) => { const p = profiles[bleId]; if (!p) throw new Error("no such device"); return p; } },
    }));
    nd = require("../services/mesh/NodeDiscovery.js").default;
  });
  nd.deviceId = "me";
  nd.ready = true;
  return nd;
}

const profile = (id, verified) => ({ id, sign: `sign-${id}`, box: `box-${id}`, verified });
const found = (bleId) => new Map([[bleId, { rssi: -60, name: "x" }]]);

beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("a verified device is recorded as verified", async () => {
  const nd = loadDiscovery({ "BB:BB": profile("bob", true) });
  await nd.resolveCandidates(found("BB:BB"));
  const bob = nd.peerMap.get("bob");
  expect(bob.bleId).toBe("BB:BB");
  expect(typeof bob.verifiedAt).toBe("number");
});

test("an unverified device that copies Bob's profile cannot take over his entry", async () => {
  const nd = loadDiscovery({ "BB:BB": profile("bob", true), "MM:MM": profile("bob", false) });
  await nd.resolveCandidates(found("BB:BB"));
  const before = nd.peerMap.get("bob");
  await nd.resolveCandidates(found("MM:MM"));
  const after = nd.peerMap.get("bob");
  expect(after.bleId).toBe("BB:BB"); // still the real Bob's address
  expect(after.verifiedAt).toBe(before.verifiedAt);
  expect(nd.bleToPeer.get("MM:MM")).toBeUndefined(); // and the impostor's address is not mapped to him
});

test("Bob legitimately turning up at a new address (verified) is accepted", async () => {
  const nd = loadDiscovery({ "BB:BB": profile("bob", true), "B2:B2": profile("bob", true) });
  await nd.resolveCandidates(found("BB:BB"));
  await nd.resolveCandidates(found("B2:B2"));
  expect(nd.peerMap.get("bob").bleId).toBe("B2:B2");
});

test("a device that never proved anything is recorded, but as unverified", async () => {
  const nd = loadDiscovery({ "OO:OO": profile("old-build", false) });
  await nd.resolveCandidates(found("OO:OO"));
  const p = nd.peerMap.get("old-build");
  expect(p.bleId).toBe("OO:OO");
  expect(p.verifiedAt).toBeNull();
});

describe("a direct message is only handed to a device that proved it is the recipient", () => {
  const { createNetwork, boot, discover, settle } = require("./helpers/meshHarness");
  let net;
  beforeEach(() => { net = createNetwork(); jest.spyOn(console, "error").mockImplementation(() => {}); });

  test("verified: delivered and readable by the recipient", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await discover(net, alice, bob, { verified: true });
    const msg = await alice.relay.createMessage(alice.id, bob.id, "private words");
    expect(await alice.relay.deliverMessage(msg)).toBe(true);
    await settle();
    expect(bob.inbox.map((m) => m.content)).toEqual(["private words"]);
  });

  test("unverified: not sent at all, and the reason is recorded", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await discover(net, alice, bob, { verified: false });
    const msg = await alice.relay.createMessage(alice.id, bob.id, "private words");
    expect(await alice.relay.deliverMessage(msg)).toBe(false);
    expect(msg.status).toBe("failed");
    expect(msg.failureReason).toBe("unverified");
    expect(alice.transport.sent).toHaveLength(0);
  });

  test("an old proof is not good for ever", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await discover(net, alice, bob, { verified: true });
    const peers = await alice.peerCache.getAllPeers();
    await alice.peerCache.storePeer({ ...peers[0], verifiedAt: Date.now() - 11 * 60 * 1000 });
    const msg = await alice.relay.createMessage(alice.id, bob.id, "private words");
    expect(await alice.relay.deliverMessage(msg)).toBe(false);
  });

  test("alerts and relays still go to unverified devices: only direct messages are held back", async () => {
    const alice = await boot(net, "alice");
    const old = await boot(net, "old");
    await discover(net, alice, old, { verified: false });
    const summary = await alice.geo.broadcast(alice.id, "Water at the school", { priority: "high" });
    expect(summary.success).toBe(1);
    await settle();
    expect(old.inbox.map((m) => m.content)).toEqual(["Water at the school"]);
  });
});
