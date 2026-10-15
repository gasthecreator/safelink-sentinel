import { verifyCatalog, CatalogError } from "../services/maps/catalog.js";

const { generateKeypair, signCatalog, buildBody, sha256Hex } = require("../scripts/lib/catalogSigner.js");

const NOW = Date.parse("2026-10-15T12:00:00Z");
const keys = generateKeypair();
const stranger = generateKeypair();

const entry = (over = {}) => ({
  id: "grambling-la", name: "Grambling, LA", version: 2, bbox: [32.5, -92.7, 32.6, -92.6], sizeBytes: 106000,
  sha256: "a".repeat(64), url: "https://example.com/maps/grambling-la-v2.json", builtAt: "2026-10-01T00:00:00Z",
  attribution: "© OpenStreetMap contributors", ...over,
});
const body = (over = {}) => ({ sequence: 5, generatedAt: "2026-10-14T00:00:00Z", packs: [entry()], ...over });
const sign = (b, k = keys) => signCatalog(b, k.secretKey);
const verify = (wire, opts = {}) => verifyCatalog(wire, { publicKey: keys.publicKey, now: NOW, ...opts });
const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return e.code;
  }
  throw new Error("expected a CatalogError");
};

describe("a genuine catalog", () => {
  test("verifies and is read", () => {
    const c = verify(sign(body()));
    expect(c.sequence).toBe(5);
    expect(c.packs).toEqual([expect.objectContaining({ id: "grambling-la", version: 2, sizeBytes: 106000 })]);
  });
  test("the publisher's real output (buildBody + signCatalog) is accepted by the app", () => {
    const pack = { name: "Town", bbox: [1, 2, 3, 4], builtAt: "2026-10-01T00:00:00Z" };
    const buffer = Buffer.from(JSON.stringify({ ...pack, format: 1 }));
    const b = buildBody({ packs: [{ id: "town", buffer, pack }], baseUrl: "https://host.example/maps/", now: new Date(NOW) });
    const c = verify(signCatalog(b, keys.secretKey));
    expect(c.packs[0]).toMatchObject({ id: "town", version: 1, sha256: sha256Hex(buffer), url: "https://host.example/maps/town-v1.json" });
  });
  test("unknown fields are dropped and the name is cleaned", () => {
    const c = verify(sign(body({ packs: [{ ...entry({ name: "Safe‮evil" }), evil: "<script>" }] })));
    expect(c.packs[0].name).toBe("Safeevil");
    expect(c.packs[0]).not.toHaveProperty("evil");
  });
});

describe("authenticity: only the publisher's key is believed", () => {
  test("signed by someone else", () => {
    expect(codeOf(() => verify(sign(body(), stranger)))).toBe("bad_signature");
  });
  test("a single changed character in the body", () => {
    const wire = sign(body());
    expect(codeOf(() => verify({ ...wire, body: wire.body.replace("106000", "106001") }))).toBe("bad_signature");
  });
  test("a swapped download address (the attack that matters)", () => {
    const wire = sign(body());
    const evil = wire.body.replace("example.com", "evil.example");
    expect(evil).not.toBe(wire.body);
    expect(codeOf(() => verify({ ...wire, body: evil }))).toBe("bad_signature");
  });
  test("a swapped hash", () => {
    const wire = sign(body());
    expect(codeOf(() => verify({ ...wire, body: wire.body.replace("a".repeat(64), "b".repeat(64)) }))).toBe("bad_signature");
  });
  test("signature damaged, truncated, empty or not base64", () => {
    const wire = sign(body());
    for (const signature of [wire.signature.slice(0, -4), "", "!!!notbase64!!!", wire.signature.replace(/^./, wire.signature[0] === "A" ? "B" : "A")]) {
      expect(codeOf(() => verify({ ...wire, signature }))).toBe("bad_signature");
    }
  });
  test("the signature is checked before anything inside is read", () => {
    // valid signature over junk is "malformed"; an invalid signature over junk is "bad_signature"
    const junk = { format: 1, body: "{not json", signature: sign(body()).signature };
    expect(codeOf(() => verify(junk))).toBe("bad_signature");
    const signedJunk = signCatalog({}, keys.secretKey);
    expect(codeOf(() => verify({ ...signedJunk, body: "{not json" }))).toBe("bad_signature");
  });
  test("no publisher key configured: refuses everything (fails closed)", () => {
    expect(codeOf(() => verify(sign(body()), { publicKey: "" }))).toBe("no_key");
    expect(codeOf(() => verify(sign(body()), { publicKey: undefined }))).toBe("no_key");
  });
  test("a publisher key that is not a key", () => {
    for (const publicKey of ["abc", "!!!", Buffer.alloc(31).toString("base64"), Buffer.alloc(64).toString("base64")]) {
      expect(codeOf(() => verify(sign(body()), { publicKey }))).toBe("no_key");
    }
  });
});

describe("freshness: an old catalog cannot be replayed", () => {
  test("older than the last seen is refused even though genuinely signed", () => {
    expect(codeOf(() => verify(sign(body({ sequence: 4 })), { lastSequence: 5 }))).toBe("stale");
  });
  test("the same or a newer one is fine", () => {
    expect(verify(sign(body({ sequence: 5 })), { lastSequence: 5 }).sequence).toBe(5);
    expect(verify(sign(body({ sequence: 9 })), { lastSequence: 5 }).sequence).toBe(9);
  });
  test("a sequence that is not a positive whole number", () => {
    for (const sequence of [0, -1, 1.5, "7", null, undefined]) {
      expect(codeOf(() => verify(sign(body({ sequence }))))).toBe("malformed");
    }
  });
  test("a date far in the future, or unreadable", () => {
    expect(codeOf(() => verify(sign(body({ generatedAt: "2030-01-01T00:00:00Z" }))))).toBe("malformed");
    expect(codeOf(() => verify(sign(body({ generatedAt: "yesterday" }))))).toBe("malformed");
  });
});

describe("shape", () => {
  test.each([
    ["null", null],
    ["a string", "catalog"],
    ["wrong format number", { format: 2, body: "{}", signature: "x" }],
    ["body not a string", { format: 1, body: {}, signature: "x" }],
    ["no signature", { format: 1, body: "{}" }],
  ])("%s is malformed", (_n, wire) => {
    expect(codeOf(() => verify(wire))).toBe("malformed");
  });
  test("a huge body is refused", () => {
    expect(codeOf(() => verify({ format: 1, body: "x".repeat(1024 * 1024 + 1), signature: sign(body()).signature }))).toBe("malformed");
  });
  test("a body without a list of packs", () => {
    expect(codeOf(() => verify(sign({ sequence: 1, generatedAt: "2026-10-14T00:00:00Z" })))).toBe("malformed");
    expect(codeOf(() => verify(sign({ sequence: 1, generatedAt: "2026-10-14T00:00:00Z", packs: "all" })))).toBe("malformed");
  });
  test("too many packs", () => {
    const packs = Array.from({ length: 201 }, (_, i) => entry({ id: `map-${i}` }));
    expect(codeOf(() => verify(sign(body({ packs }))))).toBe("malformed");
  });
});

describe("every entry is validated; one bad entry spoils the whole list", () => {
  test.each([
    ["path traversal in the id", { id: "../../etc/passwd" }],
    ["a slash in the id", { id: "a/b" }],
    ["upper-case id", { id: "Grambling" }],
    ["empty id", { id: "" }],
    ["id too long", { id: "a".repeat(65) }],
    ["id with a dot", { id: "map.json" }],
    ["no name", { name: "" }],
    ["name made only of control characters", { name: "\u0000\u0007" }],
    ["version 0", { version: 0 }],
    ["fractional version", { version: 1.5 }],
    ["string version", { version: "2" }],
    ["inverted area", { bbox: [32.6, -92.7, 32.5, -92.6] }],
    ["area off the planet", { bbox: [-100, -92.7, 32.6, -92.6] }],
    ["area with NaN", { bbox: [NaN, -92.7, 32.6, -92.6] }],
    ["area of the wrong length", { bbox: [1, 2, 3] }],
    ["size zero", { sizeBytes: 0 }],
    ["size absurd", { sizeBytes: 500 * 1024 * 1024 }],
    ["fractional size", { sizeBytes: 10.5 }],
    ["short hash", { sha256: "abc" }],
    ["upper-case hash", { sha256: "A".repeat(64) }],
    ["non-hex hash", { sha256: "z".repeat(64) }],
    ["plain http", { url: "http://example.com/x.json" }],
    ["a javascript: link", { url: "javascript:alert(1)" }],
    ["an ftp link", { url: "ftp://example.com/x.json" }],
    ["credentials hidden in the address", { url: "https://good.example@evil.example/x.json" }],
    ["not a link", { url: "x.json" }],
    ["a very long link", { url: `https://example.com/${"a".repeat(600)}` }],
  ])("%s", (_n, over) => {
    expect(codeOf(() => verify(sign(body({ packs: [entry(), entry({ id: "second", ...over })] }))))).toBe("invalid");
  });
  test("the same map listed twice", () => {
    expect(codeOf(() => verify(sign(body({ packs: [entry(), entry()] }))))).toBe("invalid");
  });
  test("plain http is allowed only when explicitly switched on (local development)", () => {
    const wire = sign(body({ packs: [entry({ url: "http://localhost:8099/x.json" })] }));
    expect(codeOf(() => verify(wire))).toBe("invalid");
    expect(verify(wire, { allowInsecure: true }).packs[0].url).toBe("http://localhost:8099/x.json");
  });
});

describe("the publisher: sequence and versions", () => {
  const pack = (name = "Town") => ({ name, bbox: [1, 2, 3, 4] });
  const file = (text) => Buffer.from(text);
  const make = (previous, packs) => buildBody({ previous, packs, baseUrl: "https://h.example/m", now: new Date(NOW) });

  test("the first catalog is sequence 1 and every pack is version 1", () => {
    const b = make(null, [{ id: "a", buffer: file("A"), pack: pack() }, { id: "b", buffer: file("B"), pack: pack() }]);
    expect(b.sequence).toBe(1);
    expect(b.packs.map((p) => p.version)).toEqual([1, 1]);
  });
  test("a re-publish with nothing changed keeps every version but still bumps the sequence", () => {
    const first = make(null, [{ id: "a", buffer: file("A"), pack: pack() }]);
    const again = make(first, [{ id: "a", buffer: file("A"), pack: pack() }]);
    expect(again.sequence).toBe(2);
    expect(again.packs[0].version).toBe(1);
  });
  test("only a pack whose content changed gets a new version, with a new file name", () => {
    const first = make(null, [{ id: "a", buffer: file("A"), pack: pack() }, { id: "b", buffer: file("B"), pack: pack() }]);
    const next = make(first, [{ id: "a", buffer: file("A2"), pack: pack() }, { id: "b", buffer: file("B"), pack: pack() }]);
    expect(next.packs.map((p) => p.version)).toEqual([2, 1]);
    expect(next.packs[0].url).toBe("https://h.example/m/a-v2.json");
    expect(next.packs[1].url).toBe("https://h.example/m/b-v1.json");
  });
  test("a base URL without a scheme is refused", () => {
    expect(() => buildBody({ packs: [], baseUrl: "example.com/maps" })).toThrow(/https/);
  });
  test("a wrong-size signing key is refused with a plain message", () => {
    expect(() => signCatalog({}, Buffer.alloc(10).toString("base64"))).toThrow(/not a valid signing key/);
  });
});
