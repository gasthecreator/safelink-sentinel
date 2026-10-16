import {
  unitsForLocale, formatDistance, spokenDistance, scaleSteps, formatAccuracy,
  setCurrentUnits, getCurrentUnits, METRIC, IMPERIAL,
} from "../services/units/units.js";
import { scaleBar } from "../services/navigation/mapView.js";
import { createAnnouncer } from "../services/navigation/guidance.js";
import { route } from "../services/navigation/router.js";
import { loadPack } from "../services/navigation/pack.js";

jest.mock("react-native", () => ({ NativeModules: {} }));

afterEach(() => setCurrentUnits(METRIC));

describe("which units a phone gets", () => {
  test.each([
    ["en-US", IMPERIAL], ["en_US", IMPERIAL], ["en-GB", IMPERIAL], ["en-LR", IMPERIAL],
    ["en-CA", METRIC], ["fr-FR", METRIC], ["es-MX", METRIC], ["en", METRIC], ["", METRIC], [undefined, METRIC],
  ])("%s -> %s", (locale, units) => expect(unitsForLocale(locale)).toBe(units));
});

describe("formatDistance", () => {
  test("metric is unchanged", () => {
    expect([4, 253, 999, 1500, 25000].map((m) => formatDistance(m, METRIC))).toEqual(["4 m", "250 m", "1000 m", "1.5 km", "25 km"]);
  });
  test("imperial: feet up to 1000 ft, then miles", () => {
    const f = (m) => formatDistance(m, IMPERIAL);
    expect(f(2)).toBe("10 ft");
    expect(f(30)).toBe("100 ft");       // 98 ft
    expect(f(100)).toBe("350 ft");      // 328 ft
    expect(f(300)).toBe("1000 ft");     // 984 ft
    expect(f(400)).toBe("0.2 mi");      // 1312 ft
    expect(f(1609.344)).toBe("1 mi");
    expect(f(2414)).toBe("1.5 mi");
    expect(f(20000)).toBe("12 mi");
  });
  test("the setting in force is used when none is given", () => {
    setCurrentUnits(IMPERIAL);
    expect(formatDistance(1609)).toBe("1 mi");
    setCurrentUnits(METRIC);
    expect(formatDistance(1609)).toBe("1.6 km");
    setCurrentUnits("nonsense");
    expect(getCurrentUnits()).toBe(METRIC);
  });
  test("nonsense is empty", () => {
    expect(formatDistance(NaN)).toBe("");
    expect(formatDistance(-5, IMPERIAL)).toBe("");
  });
});

describe("spokenDistance", () => {
  test("metric", () => {
    expect([4, 47, 180, 999, 1000, 1500].map((m) => spokenDistance(m, METRIC))).toEqual(
      ["10 meters", "50 meters", "200 meters", "1000 meters", "1 kilometre", "1.5 kilometres"]);
  });
  test("imperial reads aloud as feet and miles", () => {
    const s = (m) => spokenDistance(m, IMPERIAL);
    expect(s(25)).toBe("80 feet");
    expect(s(100)).toBe("350 feet");
    expect(s(1609.344)).toBe("1 mile");
    expect(s(2414)).toBe("1.5 miles");
    expect(s(8047)).toBe("5 miles");
  });
  test("an announcer speaks in the units it was given", () => {
    const next = (inM) => ({ ignored: false, arrived: false, endOfRoad: false, next: { text: "Turn left onto Main Street", inM, index: 1, final: false } });
    expect(createAnnouncer({ mode: "walk", units: IMPERIAL }).update(next(60))).toBe("In 200 feet, turn left onto Main Street.");
    expect(createAnnouncer({ mode: "walk", units: METRIC }).update(next(60))).toBe("In 60 meters, turn left onto Main Street.");
    expect(createAnnouncer({ mode: "drive", units: IMPERIAL }).update({ ...next(1), endOfRoad: true, toTarget: { distanceM: 288, direction: "north-east" } }))
      .toBe("You have reached the end of the mapped road. They are about 950 feet north-east of here.");
  });
});

describe("scale bar and accuracy", () => {
  test("imperial scale bars use round feet and miles that fit", () => {
    for (const mpp of [0.2, 0.5, 1, 3, 10, 40]) {
      const bar = scaleBar(mpp, 110, IMPERIAL);
      expect(bar.pixels).toBeLessThanOrEqual(110);
      expect(bar.label).toMatch(/^\d+(\.\d+)? (ft|mi)$/);
    }
    expect(scaleBar(1, 110, IMPERIAL).label).toBe("200 ft"); // 61 m ≈ 200 ft fits; 500 ft = 152 m does not
    expect(scaleBar(10, 110, METRIC).label).toBe("1 km");
    expect(scaleSteps(IMPERIAL).every((s, i, a) => i === 0 || s.m > a[i - 1].m)).toBe(true); // ascending
  });
  test("accuracy reads in the right units", () => {
    expect(formatAccuracy(5, METRIC)).toBe("±5 m");
    expect(formatAccuracy(1500, METRIC)).toBe("±1.5 km");
    expect(formatAccuracy(5, IMPERIAL)).toBe("±16 ft");
    expect(formatAccuracy(2000, IMPERIAL)).toBe("±1.2 mi");
    expect(formatAccuracy(null)).toBe("");
  });
});

describe("route warnings", () => {
  const { makePack } = require("./helpers/packs.js");
  const graph = loadPack(makePack({ nodes: [[32.52, -92.71], [32.53, -92.71]], edges: [{ a: 0, b: 1 }] })).graph;
  test("distances in warnings use the formatter given", () => {
    const far = { latitude: 32.5215, longitude: -92.7125 }; // ~230 m from the road, still inside the pack's margin
    const r = route(graph, far, { latitude: 32.529, longitude: -92.71 }, {
      mode: "walk", formatDistance: (m) => formatDistance(m, IMPERIAL),
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/\d+ ft away/);
    const plain = route(graph, far, { latitude: 32.529, longitude: -92.71 }, { mode: "walk" });
    expect(plain.warnings.join(" ")).toMatch(/\d+ m away/);
  });
});

test("null, strings and other non-numbers give nothing rather than '0 m'", () => {
  for (const bad of [null, undefined, "5", {}, NaN, -1]) {
    expect(formatDistance(bad, METRIC)).toBe("");
    expect(spokenDistance(bad, IMPERIAL)).toBe("");
    expect(formatAccuracy(bad, METRIC)).toBe("");
  }
});
