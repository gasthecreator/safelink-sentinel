import { resolveAlertLocation } from "../services/location/resolveLocation.js";

const gpsFix = { position: { latitude: 30.5, longitude: -92.2, accuracyM: 5, fixedAt: 1, source: null, label: null }, reason: null, stale: false, approximate: false };
const noFix = (reason = "unavailable") => ({ position: null, reason, stale: false, approximate: false });
const shelter = { id: "p1", name: "School shelter", latitude: 31, longitude: -91, accuracyM: 7, kind: "gps", createdAt: 1 };

test("location switched off: no position, GPS is never read", async () => {
  const getGps = jest.fn();
  const r = await resolveAlertLocation({ include: false, source: "gps" }, { getGps });
  expect(r).toEqual({ cancelled: false, switchToPlaces: false, fix: null });
  expect(getGps).not.toHaveBeenCalled();
});

test("GPS source with a fix uses it", async () => {
  const r = await resolveAlertLocation({ include: true, source: "gps" }, { getGps: async () => gpsFix });
  expect(r.fix).toBe(gpsFix);
  expect(r.cancelled).toBe(false);
});

test("a saved place is used without touching GPS", async () => {
  const getGps = jest.fn();
  const r = await resolveAlertLocation({ include: true, source: "place", place: shelter }, { getGps });
  expect(getGps).not.toHaveBeenCalled();
  expect(r.fix.position).toMatchObject({ latitude: 31, longitude: -91, source: "place", label: "School shelter" });
});

test("a saved place that is missing or invalid gives a clear reason, not a guess", async () => {
  expect((await resolveAlertLocation({ include: true, source: "place" })).fix).toMatchObject({ position: null, reason: "no_place" });
  expect((await resolveAlertLocation({ include: true, source: "place", place: { ...shelter, latitude: 500 } })).fix.reason).toBe("no_place");
});

describe("GPS has no fix: the user decides", () => {
  const run = (choice, reason) =>
    resolveAlertLocation({ include: true, source: "gps" }, { getGps: async () => noFix(reason), onNoFix: async () => choice });

  test("send anyway: goes ahead without a position", async () => {
    const r = await run("send", "timeout");
    expect(r).toMatchObject({ cancelled: false, switchToPlaces: false });
    expect(r.fix).toMatchObject({ position: null, reason: "timeout" });
  });
  test("use a saved place: the send is paused and the screen switches", async () => {
    expect(await run("places")).toMatchObject({ cancelled: true, switchToPlaces: true });
  });
  test("cancel: nothing is sent", async () => {
    expect(await run("cancel")).toMatchObject({ cancelled: true, switchToPlaces: false });
  });
  test("the question is only asked when there really is no position", async () => {
    const onNoFix = jest.fn();
    await resolveAlertLocation({ include: true, source: "gps" }, { getGps: async () => gpsFix, onNoFix });
    expect(onNoFix).not.toHaveBeenCalled();
  });
  test("with nobody to ask, it proceeds without a position", async () => {
    const r = await resolveAlertLocation({ include: true, source: "gps" }, { getGps: async () => noFix("denied") });
    expect(r).toMatchObject({ cancelled: false });
    expect(r.fix.reason).toBe("denied");
  });
});
