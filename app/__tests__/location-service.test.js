// getPositionForAlert with a scripted stand-in for the geolocation module.

function load(script) {
  const calls = [];
  let service;
  jest.isolateModules(() => {
    jest.doMock("@react-native-community/geolocation", () => ({
      __esModule: true,
      default: {
        getCurrentPosition(success, error, options) {
          calls.push(options);
          const step = script[calls.length - 1] || { error: { code: 2 } };
          if (step.fix) success(step.fix);
          else error(step.error);
        },
      },
    }));
    service = require("../services/location/LocationService.js");
  });
  return { ...service, calls };
}

const NOW = Date.now(); // position validation uses the real clock
const fix = (over = {}) => ({
  coords: { latitude: 30.5, longitude: -92.25, accuracy: 8, ...over.coords },
  timestamp: over.timestamp ?? NOW,
});

test("a fresh GPS fix is returned with its accuracy and time", async () => {
  const { getPositionForAlert, calls } = load([{ fix: fix() }]);
  const r = await getPositionForAlert(() => NOW);
  expect(r).toMatchObject({ reason: null, stale: false, approximate: false });
  expect(r.position).toMatchObject({ latitude: 30.5, longitude: -92.25, accuracyM: 8, fixedAt: NOW });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 }); // really uses GPS, not a cache
});

test("a declined permission is reported and is not retried", async () => {
  const { getPositionForAlert, calls } = load([{ error: { code: 1 } }]);
  expect(await getPositionForAlert(() => NOW)).toEqual({
    position: null, reason: "denied", stale: false, approximate: false,
  });
  expect(calls).toHaveLength(1);
});

test("no fresh fix: falls back to the last known position and marks it stale", async () => {
  const old = NOW - 20 * 60000;
  const { getPositionForAlert, calls } = load([{ error: { code: 3 } }, { fix: fix({ timestamp: old }) }]);
  const r = await getPositionForAlert(() => NOW);
  expect(r.position.fixedAt).toBe(old);
  expect(r).toMatchObject({ stale: true, reason: null });
  expect(calls[1]).toMatchObject({ maximumAge: 6 * 60 * 60 * 1000 });
});

test("no fresh fix and nothing cached: says why", async () => {
  const timeout = await load([{ error: { code: 3 } }, { error: { code: 2 } }]).getPositionForAlert(() => NOW);
  expect(timeout).toMatchObject({ position: null, reason: "timeout" });
  const unavailable = await load([{ error: { code: 2 } }, { error: { code: 2 } }]).getPositionForAlert(() => NOW);
  expect(unavailable).toMatchObject({ position: null, reason: "unavailable" });
});

test("an approximate-only fix is flagged", async () => {
  const { getPositionForAlert } = load([{ fix: fix({ coords: { accuracy: 4000 } }) }]);
  expect(await getPositionForAlert(() => NOW)).toMatchObject({ approximate: true, stale: false });
});

test("an invalid fix from the OS is not passed on", async () => {
  const { getPositionForAlert } = load([{ fix: fix({ coords: { latitude: 500 } }) }, { error: { code: 2 } }]);
  const r = await getPositionForAlert(() => NOW);
  expect(r.position).toBeNull();
});

test("an exception inside the native module does not escape", async () => {
  let service;
  jest.isolateModules(() => {
    jest.doMock("@react-native-community/geolocation", () => ({
      __esModule: true,
      default: { getCurrentPosition() { throw new Error("native crash"); } },
    }));
    service = require("../services/location/LocationService.js");
  });
  expect(await service.getPositionForAlert(() => NOW)).toMatchObject({ position: null, reason: "error" });
});
