import {
  sanitizeReport,
  effectiveClosures,
  reportText,
  REPORT_WINDOW_MS,
  CLOSURE_RADIUS_M,
} from "../services/roads/reports.js";

const NOW = 1_800_000_000_000;
const H = 3600 * 1000;
const spot = { latitude: 32.52, longitude: -92.72 };
const raw = (over = {}) => ({
  id: "r1", kind: "blocked", position: { ...spot, accuracyM: 8 }, note: "tree down", senderId: "alice", reportedAt: NOW - H, ...over,
});
const rep = (over = {}) => sanitizeReport(raw(over), NOW);

describe("sanitizeReport (reports come from other people's phones)", () => {
  test("a good report is cleaned and kept", () => {
    expect(rep()).toEqual({
      id: "r1", kind: "blocked", latitude: 32.52, longitude: -92.72, accuracyM: 8,
      note: "tree down", senderId: "alice", reportedAt: NOW - H,
    });
  });
  test.each([
    ["no object", null],
    ["a string", "blocked"],
    ["missing id", { ...raw(), id: undefined }],
    ["empty id", { ...raw(), id: "" }],
    ["huge id", { ...raw(), id: "x".repeat(65) }],
    ["numeric id", { ...raw(), id: 5 }],
    ["missing sender", { ...raw(), senderId: undefined }],
    ["huge sender", { ...raw(), senderId: "s".repeat(100) }],
    ["unknown kind", { ...raw(), kind: "on-fire" }],
    ["kind as an object", { ...raw(), kind: { toString: () => "blocked" } }],
    ["no position", { ...raw(), position: undefined }],
    ["position off the planet", { ...raw(), position: { latitude: 200, longitude: 0 } }],
    ["position as strings", { ...raw(), position: { latitude: "32", longitude: "-92" } }],
    ["time as a string", { ...raw(), reportedAt: "now" }],
    ["time NaN", { ...raw(), reportedAt: NaN }],
    ["from the future", { ...raw(), reportedAt: NOW + 3 * H }],
    ["older than a day", { ...raw(), reportedAt: NOW - 25 * H }],
  ])("refuses %s", (_n, input) => {
    expect(sanitizeReport(input, NOW)).toBeNull();
  });
  test("a note is cleaned and capped, and may be missing", () => {
    expect(rep({ note: "x".repeat(500) }).note).toHaveLength(120);
    expect(rep({ note: "a\u0000b‮c" }).note).toBe("a bc");
    expect(rep({ note: 12 }).note).toBeNull();
    expect(rep({ note: undefined }).note).toBeNull();
  });
  test("only known fields survive", () => {
    expect(Object.keys(rep({ evil: "<script>" })).sort()).toEqual(
      ["accuracyM", "id", "kind", "latitude", "longitude", "note", "reportedAt", "senderId"]
    );
  });
  test("report text is readable without this feature", () => {
    expect(reportText("blocked", "tree down")).toBe("Road blocked: tree down");
    expect(reportText("passable", null)).toBe("Road passable");
    expect(reportText("hazard", "flooding")).toBe("Hazard: flooding");
  });
});

describe("effectiveClosures: what to believe", () => {
  const at = (over) => rep(over);

  test("nothing reported, nothing to avoid", () => {
    expect(effectiveClosures([], NOW)).toEqual([]);
  });
  test("a blocked report is a closure with a radius", () => {
    const [c] = effectiveClosures([at()], NOW);
    expect(c).toMatchObject({ kind: "blocked", latitude: 32.52, longitude: -92.72, radiusM: CLOSURE_RADIUS_M, reporters: 1, disputed: false, note: "tree down" });
  });
  test("it expires after 12 hours", () => {
    expect(effectiveClosures([at({ reportedAt: NOW - REPORT_WINDOW_MS + 1000 })], NOW)).toHaveLength(1);
    expect(effectiveClosures([at({ reportedAt: NOW - REPORT_WINDOW_MS - 1000 })], NOW)).toHaveLength(0);
  });
  test("'passable' on its own is not a closure", () => {
    expect(effectiveClosures([at({ kind: "passable" })], NOW)).toEqual([]);
  });
  test("reports of the same spot are one closure, however many phones said so", () => {
    const near = { latitude: 32.52 + 0.0002, longitude: -92.72 }; // ~22 m away
    const out = effectiveClosures([at(), at({ id: "r2", senderId: "bob", position: near })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].reporters).toBe(2);
  });
  test("different places are different closures", () => {
    const far = { latitude: 32.53, longitude: -92.72 }; // ~1.1 km
    expect(effectiveClosures([at(), at({ id: "r2", senderId: "bob", position: far })], NOW)).toHaveLength(2);
  });

  describe("clearing a closure is deliberately harder than making one", () => {
    test("the person who reported it can clear it", () => {
      const out = effectiveClosures([at(), at({ id: "r2", kind: "passable", senderId: "alice", reportedAt: NOW - H / 2 })], NOW);
      expect(out).toEqual([]);
    });
    test("one stranger saying 'passable' does NOT clear it, but it is shown as disputed", () => {
      const out = effectiveClosures([at(), at({ id: "r2", kind: "passable", senderId: "mallory", reportedAt: NOW - H / 2 })], NOW);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ kind: "blocked", disputed: true });
    });
    test("two different strangers do clear it", () => {
      const out = effectiveClosures([
        at(),
        at({ id: "r2", kind: "passable", senderId: "bob", reportedAt: NOW - H / 2 }),
        at({ id: "r3", kind: "passable", senderId: "carol", reportedAt: NOW - H / 3 }),
      ], NOW);
      expect(out).toEqual([]);
    });
    test("one stranger repeating 'passable' still counts once (a single phone can't fake two)", () => {
      const out = effectiveClosures([
        at(),
        at({ id: "r2", kind: "passable", senderId: "mallory", reportedAt: NOW - H / 2 }),
        at({ id: "r3", kind: "passable", senderId: "mallory", reportedAt: NOW - H / 3 }),
        at({ id: "r4", kind: "passable", senderId: "mallory", reportedAt: NOW - H / 4 }),
      ], NOW);
      expect(out).toHaveLength(1);
    });
    test("a 'passable' from BEFORE the block does not clear it", () => {
      const out = effectiveClosures([
        at({ id: "r0", kind: "passable", senderId: "alice", reportedAt: NOW - 3 * H }),
        at({ id: "r00", kind: "passable", senderId: "bob", reportedAt: NOW - 3 * H }),
        at(),
      ], NOW);
      expect(out).toHaveLength(1);
    });
    test("a new block after a clearance blocks again", () => {
      const out = effectiveClosures([
        at({ id: "b1", reportedAt: NOW - 5 * H }),
        at({ id: "p1", kind: "passable", senderId: "alice", reportedAt: NOW - 4 * H }),
        at({ id: "b2", senderId: "dave", reportedAt: NOW - H }),
      ], NOW);
      expect(out).toHaveLength(1);
      expect(out[0].reporters).toBe(2);
    });
    test("the order the reports arrive in does not matter", () => {
      const list = [
        at(),
        at({ id: "r2", kind: "passable", senderId: "bob", reportedAt: NOW - H / 2 }),
        at({ id: "r3", kind: "passable", senderId: "carol", reportedAt: NOW - H / 3 }),
        at({ id: "r4", kind: "hazard", senderId: "dave", reportedAt: NOW - H / 4 }),
      ];
      const forward = effectiveClosures(list, NOW);
      const backward = effectiveClosures([...list].reverse(), NOW);
      expect(backward).toEqual(forward);
    });
  });

  describe("hazards", () => {
    test("a hazard is reported but is not a closure to route around", () => {
      const out = effectiveClosures([at({ kind: "hazard", note: "flooding" })], NOW);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ kind: "hazard", note: "flooding" });
    });
    test("a spot that is both blocked and hazardous is blocked", () => {
      const out = effectiveClosures([at(), at({ id: "h", kind: "hazard", senderId: "bob" })], NOW);
      expect(out.map((c) => c.kind)).toEqual(["blocked"]);
    });
    test("once the block is cleared the hazard is still shown", () => {
      const out = effectiveClosures([
        at(),
        at({ id: "h", kind: "hazard", senderId: "bob", reportedAt: NOW - H / 2 }),
        at({ id: "p", kind: "passable", senderId: "alice", reportedAt: NOW - H / 3 }),
      ], NOW);
      expect(out.map((c) => c.kind)).toEqual(["hazard"]);
    });
  });
});
