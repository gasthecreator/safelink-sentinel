import { normalizeStreetName, streetKey } from "../services/navigation/streetNames.js";
import { loadPack } from "../services/navigation/pack.js";
import { route } from "../services/navigation/router.js";

const { makePack } = require("./helpers/packs.js");

describe("one spelling per street", () => {
  test.each([
    ["Martin Luther King Jr Avenue", "Martin Luther King Junior Avenue"],
    ["Martin Luther King Jr. Ave.", "Martin Luther King Junior Avenue"],
    ["MLK Ave", "Martin Luther King Avenue"],
    ["PIne Avenue", "Pine Avenue"],
    ["MAIN STREET", "Main Street"],
    ["N Main St", "North Main Street"],
    ["W. College Ave", "West College Avenue"],
    ["Oak Rd", "Oak Road"],
    ["Pecan Blvd.", "Pecan Boulevard"],
    ["Stadium Dr", "Stadium Drive"],
    ["Park Pl", "Park Place"],
    ["Cedar Cir", "Cedar Circle"],
  ])("%s -> %s", (input, expected) => expect(normalizeStreetName(input)).toBe(expected));

  test.each([
    "Main Street", "College Avenue", "US 80", "LA 33", "I-20 Service Road", "9th Street", "63rd Avenue",
    "St Mary Street", "McDonald Road", "O'Neil Lane", "Martin Luther King Junior Avenue", "Jackson Drive",
    "North Street", "East 5th Street", "Old Farm to Market Road", "Rue de la Paix",
    "QuickCare of Ruston", "SouthStar Urgent Care", "Ruston Fire Department Station No. 3", "McDonald Road", "DeSoto Street", "LaSalle Avenue", "AutoZone Lane", "iPhone Way",
  ])("leaves %s alone", (name) => expect(normalizeStreetName(name)).toBe(name));

  test("does not turn a street named for a person into something else", () => {
    expect(normalizeStreetName("Jr Smith Road")).toBe("Junior Smith Road"); // the one real ambiguity: a Jr token is always Junior
    expect(normalizeStreetName("Sr Hwy 9")).toBe("Senior Highway 9");
    expect(normalizeStreetName("S Ave")).toBe("South Avenue"); // two words: direction then type
  });

  test("blank and non-strings are harmless", () => {
    expect(normalizeStreetName("")).toBe("");
    expect(normalizeStreetName("   ")).toBe("");
    expect(normalizeStreetName(null)).toBe("");
    expect(normalizeStreetName(42)).toBe("");
  });

  test("streetKey makes spellings comparable", () => {
    expect(streetKey("Martin Luther King Jr Avenue")).toBe(streetKey("Martin Luther King Junior Avenue"));
    expect(streetKey("PIne Avenue")).toBe(streetKey("Pine Avenue"));
    expect(streetKey("Pine Avenue")).not.toBe(streetKey("Pine Street"));
  });

  test("idempotent: normalising twice changes nothing", () => {
    for (const n of ["MLK Ave", "N Main St", "PIne Avenue", "Martin Luther King Jr. Ave.", "MAIN STREET", "US 80"]) {
      expect(normalizeStreetName(normalizeStreetName(n))).toBe(normalizeStreetName(n));
    }
  });
});

describe("directions no longer announce a turn between two spellings of one street", () => {
  // a straight road whose two halves are named differently in OpenStreetMap
  const pack = makePack({
    nodes: [[32.52, -92.71], [32.522, -92.71], [32.524, -92.71], [32.526, -92.71]],
    edges: [
      { a: 0, b: 1, name: "Martin Luther King Jr Avenue" },
      { a: 1, b: 2, name: "Martin Luther King Junior Avenue" },
      { a: 2, b: 3, name: "Martin Luther King Junior Avenue" },
    ],
  });
  const graph = loadPack(pack).graph;
  test("names are normalised when a map is loaded", () => {
    expect(graph.names.filter(Boolean)).toContain("Martin Luther King Junior Avenue");
    expect(graph.names.some((n) => /\bJr\b/.test(n))).toBe(false);
  });
  test("a straight route along it is one step, not two", () => {
    const r = route(graph, { latitude: 32.5201, longitude: -92.71 }, { latitude: 32.5259, longitude: -92.71 }, { mode: "walk" });
    expect(r.ok).toBe(true);
    const texts = r.steps.map((s) => s.text);
    expect(texts).toEqual(["Head north on Martin Luther King Junior Avenue", "You have arrived"]);
  });
});

describe("the real Grambling and Ruston names", () => {
  const raw = require("../assets/maps/grambling-la.json");
  const graph = loadPack(raw).graph;
  test("no two names in the map are the same street spelled differently", () => {
    const seen = new Map();
    for (const n of graph.names.filter(Boolean)) {
      const k = streetKey(n);
      expect(seen.has(k) && seen.get(k) !== n ? [n, seen.get(k)] : null).toBeNull();
      seen.set(k, n);
    }
  });
});
