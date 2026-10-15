// Simulated phones with a fake radio in place of BLE. Identity, envelopes,
// relay, outbox and storage are all real; only the transport is faked.

function createNetwork() {
  const devices = new Map(); // node id -> device
  const links = new Set(); // "a|b" pairs in radio range
  return {
    devices,
    link(a, b) { links.add(`${a}|${b}`); links.add(`${b}|${a}`); },
    unlink(a, b) { links.delete(`${a}|${b}`); links.delete(`${b}|${a}`); },
    inRange: (a, b) => links.has(`${a}|${b}`),
  };
}

// `store` can be passed in to simulate an app restart on the same phone storage.
function newDevice(network, name, store = {}) {
  let device;
  jest.isolateModules(() => {
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
      sent: [], // { to, id, hops } for every successful send
      failNext: new Set(), // peer ids whose next send should fail
      send: async (peer, bytes) => {
        const me = device.id;
        if (transport.failNext.has(peer.id)) {
          transport.failNext.delete(peer.id);
          throw new Error("simulated radio failure");
        }
        if (!network.inRange(me, peer.id)) throw new Error("out of range");
        const env = JSON.parse(Buffer.from(bytes).toString("utf8"));
        transport.sent.push({ to: peer.id, id: env.id, hops: env.hops });
        const target = network.devices.get(peer.id);
        if (target) await target.relay.receive(bytes);
      },
    };
    jest.doMock("../../services/ble/BleTransport.js", () => ({ __esModule: true, default: transport }));
    jest.doMock("../../services/storage/AnalyticsLogger.js", () => ({
      __esModule: true,
      default: { logPending() {}, logDelivery() {} },
    }));
    device = {
      name,
      store,
      transport,
      Id: require("../../services/crypto/IdentityManager.js").default,
      Env: require("../../services/crypto/Envelope.js"),
      relay: require("../../services/mesh/MessageRelay.js").default,
      outbox: require("../../services/mesh/Outbox.js").default,
      geo: require("../../services/mesh/GeoBroadcast.js").default,
      alerts: require("../../services/mesh/AlertManager.js").default,
      roads: require("../../services/roads/RoadReportStore.js").default,
      peerCache: require("../../services/storage/PeerCache.js"),
      inbox: [],
    };
    device.relay.onMessageReceived((m) => device.inbox.push(m));
    // as MeshManager wires it: a verified message becomes an alert / relief request
    device.relay.onMessageReceived((m) =>
      (m.meta?.type === "road_report" ? device.roads : device.alerts).handleIncoming(m).catch(() => {})
    );
  });
  return device;
}

async function boot(network, name, store) {
  const d = newDevice(network, name, store);
  d.id = await d.Id.getDeviceId();
  network.devices.set(d.id, d);
  return d;
}

/** `a` learns that `b` exists (as discovery would) and, if inRange, can reach it. */
async function discover(network, a, b, { reachable = true } = {}) {
  const pb = await b.Id.getPublicProfile();
  await a.peerCache.storePeer({
    id: pb.id, bleId: `ble-${b.name}`, name: b.name, rssi: -50, sign: pb.sign, box: pb.box,
    timestamp: new Date().toISOString(),
  });
  if (reachable) network.link(a.id, b.id);
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

module.exports = { createNetwork, boot, discover, settle };
