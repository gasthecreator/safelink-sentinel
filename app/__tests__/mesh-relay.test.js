// Three simulated phones (alice - bob - carol) with a fake radio in place of BLE.
// Only the transport is faked; identity, envelopes, relay, dedupe and storage are real.

const network = new Map(); // node id -> device
const links = new Set(); // "a|b" pairs that are in radio range of each other

const inRange = (a, b) => links.has(`${a}|${b}`) || links.has(`${b}|${a}`);

function newDevice(name) {
  let device;
  jest.isolateModules(() => {
    const store = {};
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: {
        getItem: async (k) => store[k] ?? null,
        setItem: async (k, v) => { store[k] = v; },
        removeItem: async (k) => { delete store[k]; },
      },
    }));
    global.AsyncStorage = undefined;
    const transport = {
      sent: [],
      send: async (peer, bytes) => {
        const me = device.id;
        if (!inRange(me, peer.id)) throw new Error("out of range");
        transport.sent.push(peer.id);
        // deliver asynchronously like a real radio would
        await network.get(peer.id).relay.receive(bytes);
      },
    };
    jest.doMock("../services/ble/BleTransport.js", () => ({ __esModule: true, default: transport }));
    jest.doMock("../services/storage/AnalyticsLogger.js", () => ({
      __esModule: true,
      default: { logPending() {}, logDelivery() {} },
    }));
    const Id = require("../services/crypto/IdentityManager.js").default;
    const Env = require("../services/crypto/Envelope.js");
    const relay = require("../services/mesh/MessageRelay.js").default;
    const peerCache = require("../services/storage/PeerCache.js");
    device = { name, store, transport, Id, Env, relay, peerCache, inbox: [] };
    relay.onMessageReceived((m) => device.inbox.push(m));
  });
  return device;
}

async function introduce(a, b) {
  const pb = await b.Id.getPublicProfile();
  await a.peerCache.storePeer({
    id: pb.id, bleId: `ble-${b.name}`, name: b.name, rssi: -50, sign: pb.sign, box: pb.box,
    timestamp: new Date().toISOString(),
    verifiedAt: Date.now(), // the device answered the identity challenge (see PeerProof / peerTrust)
  });
  links.add(`${(await a.Id.getDeviceId())}|${pb.id}`);
}

let alice, bob, carol;
beforeEach(async () => {
  network.clear();
  links.clear();
  alice = newDevice("alice");
  bob = newDevice("bob");
  carol = newDevice("carol");
  for (const d of [alice, bob, carol]) {
    d.id = await d.Id.getDeviceId();
    network.set(d.id, d);
  }
  // alice <-> bob <-> carol; alice and carol are NOT in range of each other
  await introduce(alice, bob);
  await introduce(bob, alice);
  await introduce(bob, carol);
  await introduce(carol, bob);
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const settle = () => new Promise((r) => setTimeout(r, 20));

test("direct message is delivered, decrypted and readable only by the recipient", async () => {
  const msg = await alice.relay.createMessage(alice.id, bob.id, "Need insulin at 5th St", { priority: "high" });
  expect(msg.encrypted).toBe(true);
  expect(await alice.relay.deliverMessage(msg)).toBe(true);
  expect(msg.status).toBe("delivered");

  expect(bob.inbox).toHaveLength(1);
  expect(bob.inbox[0]).toMatchObject({
    from: alice.id, type: "direct", content: "Need insulin at 5th St", meta: { priority: "high" },
  });
  // the plaintext never appears in what is stored/sent for a direct message
  expect(JSON.stringify(msg.envelope)).not.toContain("insulin");
});

test("broadcast reaches the neighbour and is relayed to a node out of range of the sender", async () => {
  const msg = await alice.relay.createMessage(alice.id, null, "Flood warning", { type: "alert" });
  msg.receiverId = bob.id; // next hop
  expect(await alice.relay.deliverMessage(msg)).toBe(true);
  await settle();

  expect(bob.inbox.map((m) => m.content)).toEqual(["Flood warning"]);
  expect(carol.inbox.map((m) => m.content)).toEqual(["Flood warning"]);
  expect(carol.inbox[0].from).toBe(alice.id); // origin preserved across the relay
  expect(carol.inbox[0].hops).toBe(1);
});

test("a direct message for someone else is relayed but not readable by the relay", async () => {
  await introduce(alice, carol); // alice can address carol directly (has her key) ...
  links.delete(`${alice.id}|${carol.id}`); // ... but carol is out of radio range
  const msg = await alice.relay.createMessage(alice.id, carol.id, "secret for carol", {});
  msg.receiverId = bob.id; // hand to bob as next hop
  await alice.relay.deliverMessage(msg);
  await settle();

  expect(bob.inbox).toHaveLength(0); // bob can't read it
  expect(carol.inbox.map((m) => m.content)).toEqual(["secret for carol"]);
});

test("duplicates are processed once and don't loop", async () => {
  const msg = await alice.relay.createMessage(alice.id, null, "once only", {});
  msg.receiverId = bob.id;
  await alice.relay.deliverMessage(msg);
  await settle();
  const again = await bob.relay.receive(bob.Env.encodeEnvelope(msg.envelope));
  expect(again).toBeNull();
  expect(bob.inbox).toHaveLength(1);
  expect(carol.inbox).toHaveLength(1);
  // bob relays to alice and carol once each (alice drops it as her own)
  expect(bob.transport.sent.filter((id) => id === carol.id)).toHaveLength(1);
});

test("hop limit stops the relay", async () => {
  // ttl 1 means "one hop only": bob receives it but must not pass it to carol
  const env = await alice.Env.createEnvelope({ id: "ttl-1", content: "short range", ttl: 1 });
  expect(await bob.relay.receive(alice.Env.encodeEnvelope(env))).not.toBeNull();
  await settle();
  expect(bob.inbox.map((m) => m.content)).toEqual(["short range"]);
  expect(carol.inbox).toHaveLength(0);

  // ttl 3 travels alice -> bob -> carol
  const env3 = await alice.Env.createEnvelope({ id: "ttl-3", content: "wider", ttl: 3 });
  await bob.relay.receive(alice.Env.encodeEnvelope(env3));
  await settle();
  expect(carol.inbox.map((m) => m.content)).toEqual(["wider"]);
});

test("changing ttl after signing is rejected", async () => {
  const env = await alice.Env.createEnvelope({ id: "ttl-x", content: "x", ttl: 1 });
  expect(await bob.relay.receive(alice.Env.encodeEnvelope({ ...env, ttl: 16 }))).toBeNull();
});

test("tampered or forged messages are dropped", async () => {
  const encodeEnvelope = alice.Env.encodeEnvelope;
  const msg = await alice.relay.createMessage(alice.id, null, "All clear", {});
  const tampered = { ...msg.envelope, body: JSON.stringify({ content: "Evacuate now", meta: {} }) };
  expect(await bob.relay.receive(encodeEnvelope(tampered))).toBeNull();
  const spoofed = { ...msg.envelope, from: carol.id };
  expect(await bob.relay.receive(encodeEnvelope(spoofed))).toBeNull();
  expect(await bob.relay.receive(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(bob.inbox).toHaveLength(0);
});

test("a failed send backs the peer off instead of blacklisting it forever", async () => {
  links.clear(); // everyone out of range
  const msg = await alice.relay.createMessage(alice.id, bob.id, "hello", {});
  expect(await alice.relay.deliverMessage(msg)).toBe(false);
  expect(alice.relay.isBackedOff(bob.id)).toBe(true);
  alice.relay.peerBackoff.set(bob.id, Date.now() - 1); // backoff elapsed
  links.add(`${alice.id}|${bob.id}`);
  msg.status = "pending";
  expect(await alice.relay.deliverMessage(msg)).toBe(true);
});

test("a direct message to a peer with no known key fails loudly, not silently", async () => {
  const stranger = await carol.Id.getPublicProfile();
  const msg = await alice.relay.createMessage(alice.id, stranger.id, "hi", {});
  expect(msg).toBeUndefined(); // createMessage logs the error and returns undefined
});
