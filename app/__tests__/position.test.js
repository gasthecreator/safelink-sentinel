import {
  sanitizePosition,
  describePosition,
  mapsUrl,
  describeLocationOutcome,
  APPROXIMATE_ABOVE_M,
} from "../services/location/position.js";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const good = { latitude: 30.5, longitude: -92.25, accuracyM: 12.4, fixedAt: NOW - 3 * 60000 };

describe("sanitizePosition (positions come from other people's phones)", () => {
  test("keeps a good position and rounds it", () => {
    expect(sanitizePosition({ ...good, latitude: 30.123456789 }, NOW)).toEqual({
      latitude: 30.123457, longitude: -92.25, accuracyM: 12, fixedAt: good.fixedAt, source: null, label: null,
    });
  });

  test.each([
    ["null", null],
    ["a string", "30,-92"],
    ["missing longitude", { latitude: 30 }],
    ["string coordinates", { latitude: "30", longitude: "-92" }],
    ["NaN", { latitude: NaN, longitude: 0 }],
    ["Infinity", { latitude: 0, longitude: Infinity }],
    ["latitude > 90", { latitude: 90.5, longitude: 0 }],
    ["latitude < -90", { latitude: -91, longitude: 0 }],
    ["longitude > 180", { latitude: 0, longitude: 181 }],
    ["longitude < -180", { latitude: 0, longitude: -180.1 }],
  ])("rejects %s", (_name, input) => {
    expect(sanitizePosition(input, NOW)).toBeNull();
  });

  test("accepts the extremes of the valid range", () => {
    expect(sanitizePosition({ latitude: 90, longitude: 180 }, NOW)).toMatchObject({ latitude: 90, longitude: 180 });
    expect(sanitizePosition({ latitude: -90, longitude: -180 }, NOW)).toMatchObject({ latitude: -90, longitude: -180 });
  });

  test("drops bad accuracy or fix time but keeps the position", () => {
    for (const accuracyM of [-1, NaN, "5", 1e9, Infinity]) {
      expect(sanitizePosition({ ...good, accuracyM }, NOW).accuracyM).toBeNull();
    }
    for (const fixedAt of [NOW + 60 * 60000, NOW - 40 * 24 * 3600000, "now", NaN]) {
      expect(sanitizePosition({ ...good, fixedAt }, NOW).fixedAt).toBeNull();
    }
    expect(sanitizePosition({ latitude: 1, longitude: 2 }, NOW)).toEqual({
      latitude: 1, longitude: 2, accuracyM: null, fixedAt: null, source: null, label: null,
    });
  });

  test("copies only the known fields (nothing extra is smuggled through)", () => {
    const out = sanitizePosition({ ...good, evil: "<script>", __proto__: { x: 1 } }, NOW);
    expect(Object.keys(out).sort()).toEqual(["accuracyM", "fixedAt", "label", "latitude", "longitude", "source"]);
  });
});

describe("describePosition", () => {
  test("coordinates, accuracy and age", () => {
    expect(describePosition(good, NOW)).toMatchObject({
      coords: "30.50000, -92.25000", accuracy: "±12 m", age: "3 min ago", approximate: false,
      text: "30.50000, -92.25000 (±12 m, fix 3 min ago)",
    });
  });

  test("flags an approximate area and uses kilometres", () => {
    const d = describePosition({ ...good, accuracyM: 3000 }, NOW);
    expect(d.approximate).toBe(true);
    expect(d.accuracy).toBe("±3.0 km");
    expect(describePosition({ ...good, accuracyM: APPROXIMATE_ABOVE_M }, NOW).approximate).toBe(false);
    expect(describePosition({ ...good, accuracyM: APPROXIMATE_ABOVE_M + 1 }, NOW).approximate).toBe(true);
  });

  test("copes with unknown accuracy and age, and with garbage", () => {
    expect(describePosition({ latitude: 1, longitude: 2 }, NOW).text).toBe("1.00000, 2.00000");
    expect(describePosition(null, NOW)).toBeNull();
    expect(describePosition({ latitude: 999, longitude: 0 }, NOW)).toBeNull();
  });

  test("age wording", () => {
    const age = (ms) => describePosition({ ...good, fixedAt: NOW - ms }, NOW).age;
    expect(age(10 * 1000)).toBe("just now");
    expect(age(90 * 60000)).toBe("1 h ago");
    expect(age(50 * 3600000)).toBe("2 d ago");
  });
});

describe("mapsUrl", () => {
  test("opens the phone's own maps app on each platform", () => {
    expect(mapsUrl(good, "Need water", "android")).toBe("geo:30.5,-92.25?q=30.5,-92.25(Need%20water)");
    expect(mapsUrl(good, "Need water", "ios")).toBe("https://maps.apple.com/?ll=30.5,-92.25&q=Need%20water");
  });
  test("escapes the label so it cannot inject into the URL", () => {
    const url = mapsUrl(good, "a&b=c)#", "ios");
    expect(url).toBe("https://maps.apple.com/?ll=30.5,-92.25&q=a%26b%3Dc)%23");
  });
  test("no link for a missing or invalid position", () => {
    expect(mapsUrl(null, "x", "ios")).toBeNull();
    expect(mapsUrl({ latitude: 200, longitude: 0 }, "x", "android")).toBeNull();
  });
});

describe("describeLocationOutcome (what the sender is told)", () => {
  const position = sanitizePosition(good, NOW);
  test("attached", () => {
    expect(describeLocationOutcome({ position }, NOW)).toBe("Location attached (±12 m).");
  });
  test("stale fix says how old it is", () => {
    expect(describeLocationOutcome({ position, stale: true }, NOW)).toContain("3 min ago");
  });
  test("approximate asks for precise location", () => {
    const rough = sanitizePosition({ ...good, accuracyM: 4000 }, NOW);
    expect(describeLocationOutcome({ position: rough, approximate: true }, NOW)).toMatch(/approximately.*precise location/);
  });
  test("each failure has its own wording", () => {
    expect(describeLocationOutcome({ reason: "denied" })).toMatch(/permission was declined/);
    expect(describeLocationOutcome({ reason: "unavailable" })).toMatch(/no GPS fix/);
    expect(describeLocationOutcome({ reason: "timeout" })).toMatch(/in time/);
    expect(describeLocationOutcome({})).toBe("Sent without your location.");
  });
});
