import { parseCoordinates, sanitizePlace, placeToPosition } from "../services/location/places.js";
import { sanitizePosition, sanitizeText, describePosition, describeLocationOutcome } from "../services/location/position.js";

describe("parseCoordinates", () => {
  test.each([
    ["30.5, -92.2", { latitude: 30.5, longitude: -92.2 }],
    ["30.5,-92.2", { latitude: 30.5, longitude: -92.2 }],
    ["  30.5   -92.2 ", { latitude: 30.5, longitude: -92.2 }],
    ["30.5; -92.2", { latitude: 30.5, longitude: -92.2 }],
    ["30.5° -92.2°", { latitude: 30.5, longitude: -92.2 }],
    ["30.5N 92.2W", { latitude: 30.5, longitude: -92.2 }],
    ["30.5 S, 92.2 E", { latitude: -30.5, longitude: 92.2 }],
    ["-33.8688, 151.2093", { latitude: -33.8688, longitude: 151.2093 }],
    ["+30, +92", { latitude: 30, longitude: 92 }],
    ["90, 180", { latitude: 90, longitude: 180 }],
    ["-90, -180", { latitude: -90, longitude: -180 }],
  ])("reads %s", (input, expected) => {
    expect(parseCoordinates(input)).toEqual(expected);
  });

  test.each([
    "",
    "hello",
    "30.5",
    "30.5, ",
    "91, 0",
    "0, 181",
    "-91, 0",
    "30.5, -92.2, 10",
    "30°30'N 92°12'W", // degrees/minutes/seconds are not guessed at
    "30,5 -92,2", // decimal commas are ambiguous
    "NaN, 0",
    "1e2, 0",
    "30.5 N, 92.2 N",
  ])("refuses %j rather than guessing", (input) => {
    expect(parseCoordinates(input)).toBeNull();
  });

  test("refuses non-strings", () => {
    for (const v of [null, undefined, 5, {}, ["30,-92"]]) expect(parseCoordinates(v)).toBeNull();
  });
});

describe("sanitizeText", () => {
  test("tidies whitespace and removes control characters", () => {
    expect(sanitizeText("  2nd   floor,\n behind\tthe pharmacy ")).toBe("2nd floor, behind the pharmacy");
    expect(sanitizeText("a\u0000b\u0007c")).toBe("a b c");
    // direction overrides and zero-width characters can spoof or hide text: removed outright
    expect(sanitizeText("safe\u202Eevil\u200Bhidden\uFEFF")).toBe("safeevilhidden");
  });
  test("caps length and rejects empty or non-strings", () => {
    expect(sanitizeText("x".repeat(500))).toHaveLength(200);
    expect(sanitizeText("x".repeat(500), 60)).toHaveLength(60);
    for (const v of ["", "   ", "\n\t", null, 7, {}, ["a"]]) expect(sanitizeText(v)).toBeNull();
  });
});

describe("position source and label", () => {
  const base = { latitude: 30.5, longitude: -92.25 };
  test("only known sources are kept; the label only for a saved place", () => {
    expect(sanitizePosition({ ...base, source: "gps", label: "x" })).toMatchObject({ source: "gps", label: null });
    expect(sanitizePosition({ ...base, source: "place", label: "School shelter" })).toMatchObject({
      source: "place", label: "School shelter",
    });
    expect(sanitizePosition({ ...base, source: "manual" })).toMatchObject({ source: "manual", label: null });
    expect(sanitizePosition({ ...base, source: "satellite-magic" }).source).toBeNull();
    expect(sanitizePosition({ ...base, source: { toString: () => "gps" } }).source).toBeNull();
  });
  test("a hostile label is cleaned and capped", () => {
    const p = sanitizePosition({ ...base, source: "place", label: `${"A".repeat(300)}\n\u0000` });
    expect(p.label).toHaveLength(60);
    expect(sanitizePosition({ ...base, source: "place", label: 42 }).label).toBeNull();
  });
  test("provenance is explained to the reader", () => {
    expect(describePosition({ ...base, source: "place", label: "School shelter" }).provenance).toBe(
      'From the saved place "School shelter"'
    );
    expect(describePosition({ ...base, source: "manual" }).provenance).toBe("Entered by hand, not measured");
    expect(describePosition({ ...base, source: "gps" }).provenance).toBeNull();
  });
  test("the sender is told what was attached", () => {
    const place = sanitizePosition({ ...base, source: "place", label: "School shelter" });
    expect(describeLocationOutcome({ position: place })).toBe('Saved place "School shelter" attached.');
    expect(describeLocationOutcome({ position: sanitizePosition({ ...base, source: "manual" }) })).toBe(
      "Typed-in position attached."
    );
    expect(describeLocationOutcome({ reason: "no_place" })).toMatch(/no saved place was chosen/);
  });
});

describe("sanitizePlace / placeToPosition", () => {
  const place = { id: "p1", name: "School shelter", latitude: 30.5, longitude: -92.2, accuracyM: 8, kind: "gps", createdAt: 1000 };

  test("a valid place round-trips", () => {
    expect(sanitizePlace(place)).toEqual(place);
  });
  test("bad places are rejected", () => {
    for (const bad of [null, "x", {}, { ...place, name: "" }, { ...place, name: 5 }, { ...place, id: 1 },
      { ...place, latitude: 100 }, { ...place, longitude: "1" }]) {
      expect(sanitizePlace(bad)).toBeNull();
    }
  });
  test("an unknown kind falls back to gps; accuracy and time are kept clean", () => {
    expect(sanitizePlace({ ...place, kind: "weird" }).kind).toBe("gps");
    expect(sanitizePlace({ ...place, accuracyM: -5 }).accuracyM).toBeNull();
    expect(sanitizePlace({ ...place, createdAt: "yesterday" }).createdAt).toBeNull();
  });
  test("choosing a saved place gives a position labelled with its name, with no fix time", () => {
    expect(placeToPosition(place)).toEqual({
      latitude: 30.5, longitude: -92.2, accuracyM: 8, fixedAt: null, source: "place", label: "School shelter",
    });
  });
  test("a typed-in place is marked manual", () => {
    expect(placeToPosition({ ...place, kind: "manual", accuracyM: null })).toMatchObject({ source: "manual", label: null });
  });
  test("an invalid place gives no position", () => {
    expect(placeToPosition({ ...place, latitude: 500 })).toBeNull();
    expect(placeToPosition(null)).toBeNull();
  });
});
