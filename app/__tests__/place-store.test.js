function load(initial = {}) {
  const store = { ...initial };
  let mod;
  jest.isolateModules(() => {
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: {
        getItem: async (k) => store[k] ?? null,
        setItem: async (k, v) => { store[k] = v; },
        removeItem: async (k) => { delete store[k]; },
      },
    }));
    mod = require("../services/location/PlaceStore.js");
  });
  return { store, ...mod };
}

const here = { latitude: 30.5, longitude: -92.2, accuracyM: 6 };

beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("starts empty", async () => {
  expect(await load().listPlaces()).toEqual([]);
});

test("saves a place and lists it, newest first", async () => {
  const { addPlace, listPlaces } = load();
  jest.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);
  await addPlace({ name: "Home", position: here });
  await addPlace({ name: "School shelter", position: here, kind: "manual" });
  const places = await listPlaces();
  expect(places.map((p) => p.name)).toEqual(["School shelter", "Home"]);
  expect(places[0]).toMatchObject({ kind: "manual", latitude: 30.5, longitude: -92.2 });
  expect(places[0].id).toBeTruthy();
});

test("survives an app restart", async () => {
  const first = load();
  await first.addPlace({ name: "Home", position: here });
  const second = load(first.store);
  expect((await second.listPlaces()).map((p) => p.name)).toEqual(["Home"]);
});

test("a blank name or invalid position is refused with a readable message", async () => {
  const { addPlace, listPlaces } = load();
  await expect(addPlace({ name: "   ", position: here })).rejects.toThrow(/name/);
  await expect(addPlace({ name: "x", position: { latitude: 99, longitude: 0 } })).rejects.toThrow(/isn't valid/);
  expect(await listPlaces()).toEqual([]);
});

test("a name is cleaned before it is stored", async () => {
  const { addPlace } = load();
  const place = await addPlace({ name: `  School\n\tshelter ${"x".repeat(100)}`, position: here });
  expect(place.name.length).toBeLessThanOrEqual(60);
  expect(place.name.startsWith("School shelter")).toBe(true);
});

test("deleting removes only that place", async () => {
  const { addPlace, removePlace, listPlaces } = load();
  const a = await addPlace({ name: "A", position: here });
  await addPlace({ name: "B", position: here });
  await removePlace(a.id);
  expect((await listPlaces()).map((p) => p.name)).toEqual(["B"]);
  await removePlace("does-not-exist"); // no error
  expect(await listPlaces()).toHaveLength(1);
});

test("the list is capped", async () => {
  const { addPlace, MAX_PLACES } = load();
  for (let i = 0; i < MAX_PLACES; i++) await addPlace({ name: `P${i}`, position: here });
  await expect(addPlace({ name: "one too many", position: here })).rejects.toThrow(/up to 50/);
});

test("corrupt or tampered storage is ignored entry by entry, not fatal", async () => {
  const good = { id: "g", name: "Good", latitude: 1, longitude: 2, kind: "gps", createdAt: 5 };
  const stored = JSON.stringify([good, { id: "bad", name: "Bad", latitude: 500, longitude: 0 }, "junk", null, {}]);
  const { listPlaces } = load({ "@safelink_places": stored });
  expect((await listPlaces()).map((p) => p.name)).toEqual(["Good"]);
  expect(await load({ "@safelink_places": "{not json" }).listPlaces()).toEqual([]);
  expect(await load({ "@safelink_places": '{"a":1}' }).listPlaces()).toEqual([]);
});
