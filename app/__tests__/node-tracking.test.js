// NodeDiscovery.startTracking with a fake Bluetooth manager.

function load() {
  const manager = {
    scans: [],
    stops: 0,
    startDeviceScan(uuids, options, cb) { manager.scans.push({ uuids, options, cb }); },
    stopDeviceScan() { manager.stops += 1; },
  };
  let nd;
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({
      Platform: { OS: "android", Version: 30 },
      PermissionsAndroid: { PERMISSIONS: {}, RESULTS: {}, request: async () => "granted", requestMultiple: async () => ({}) },
      NativeModules: {},
      NativeEventEmitter: class { addListener() { return { remove() {} }; } },
    }));
    jest.doMock("../services/ble/bleManager.js", () => ({ getBleManager: () => manager }));
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
    }));
    nd = require("../services/mesh/NodeDiscovery.js").default;
  });
  nd.ready = true;
  return { nd, manager };
}

const peer = (over = {}) => ({
  id: "node-a", bleId: "AA:BB", name: "A", rssi: -60, type: "BLE", timestamp: new Date().toISOString(), ...over,
});

beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("refuses when the phone isn't known, is stale, has no address, or Bluetooth isn't ready", () => {
  const { nd, manager } = load();
  expect(nd.startTracking("nobody", () => {})).toBeNull();

  nd.peerMap.set("node-a", peer({ timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() }));
  expect(nd.startTracking("node-a", () => {})).toBeNull();

  nd.peerMap.set("node-a", peer({ bleId: undefined }));
  expect(nd.startTracking("node-a", () => {})).toBeNull();

  nd.peerMap.set("node-a", peer());
  nd.ready = false;
  expect(nd.startTracking("node-a", () => {})).toBeNull();

  nd.peerMap.set("sim", peer({ id: "sim", simulated: true }));
  nd.ready = true;
  expect(nd.startTracking("sim", () => {})).toBeNull();
  expect(manager.scans).toHaveLength(0);
});

test("scans continuously for the SafeLink service and reports only that phone's readings", () => {
  const { nd, manager } = load();
  nd.peerMap.set("node-a", peer());
  const samples = [];
  const stop = nd.startTracking("node-a", (rssi) => samples.push(rssi));
  expect(typeof stop).toBe("function");

  expect(manager.scans).toHaveLength(1);
  expect(manager.scans[0].uuids).toEqual(["7b3f6a10-5afe-4e1d-9a2c-5afe11c0de00"]);
  expect(manager.scans[0].options).toMatchObject({ allowDuplicates: true, scanMode: 2 });

  const { cb } = manager.scans[0];
  cb(null, { id: "AA:BB", rssi: -61 });
  cb(null, { id: "SOMEONE:ELSE", rssi: -40 }); // another phone: ignored
  cb(null, { id: "AA:BB", rssi: -58 });
  cb(null, { id: "AA:BB", rssi: undefined }); // no reading: ignored
  cb(new Error("scan failed"), null); // errors don't throw
  cb(null, null);
  expect(samples).toEqual([-61, -58]);
});

test("normal discovery steps aside while tracking, and resumes after", async () => {
  const { nd, manager } = load();
  nd.peerMap.set("node-a", peer());
  const stop = nd.startTracking("node-a", () => {});
  const before = manager.scans.length;
  await nd.startDiscovery();
  expect(manager.scans).toHaveLength(before); // discovery did not start a second scan
  expect(nd.tracking).toBe(true);

  stop();
  expect(nd.tracking).toBe(false);
  expect(manager.stops).toBeGreaterThan(0);
});

test("starting a second track stops the first", () => {
  const { nd, manager } = load();
  nd.peerMap.set("node-a", peer());
  nd.peerMap.set("node-b", peer({ id: "node-b", bleId: "CC:DD" }));
  const a = [];
  const b = [];
  nd.startTracking("node-a", (r) => a.push(r));
  nd.startTracking("node-b", (r) => b.push(r));
  const latest = manager.scans[manager.scans.length - 1].cb;
  latest(null, { id: "CC:DD", rssi: -50 });
  latest(null, { id: "AA:BB", rssi: -50 });
  expect(b).toEqual([-50]);
  expect(a).toEqual([]);
});

test("a normal scan that ends while tracking has begun does not kill the tracking scan", async () => {
  const { nd, manager } = load();
  nd.scanTimeout = 20;
  const running = nd.scan(manager); // a discovery scan in flight
  nd.tracking = true; // tracking takes over the radio mid-scan
  const stopsBefore = manager.stops;
  await running;
  expect(manager.stops).toBe(stopsBefore); // it did not call stopDeviceScan
});

test("stopTracking is safe to call when nothing is being tracked", () => {
  const { nd, manager } = load();
  expect(() => nd.stopTracking()).not.toThrow();
  expect(manager.stops).toBe(0);
});
