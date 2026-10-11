import { bytesToBase64, base64ToBytes, utf8Encode, utf8Decode } from "../services/ble/codec.js";
import {
  encodeFrames,
  Reassembler,
  maxFramePayload,
  FRAME_HEADER_SIZE,
  MAX_MESSAGE_BYTES,
} from "../services/ble/BleProtocol.js";

const rand = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

describe("codec", () => {
  test("base64 matches Buffer for every length mod 3", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = rand(n);
      const expected = Buffer.from(bytes).toString("base64");
      expect(bytesToBase64(bytes)).toBe(expected);
      expect(Array.from(base64ToBytes(expected))).toEqual(Array.from(bytes));
    }
  });

  test("base64 rejects garbage", () => {
    expect(() => base64ToBytes("not*base64")).toThrow();
  });

  test("utf8 round-trips ASCII, accents, CJK and emoji", () => {
    const samples = ["hello", "café ñ", "救命", "🆘 help 🚑", ""];
    for (const s of samples) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(Buffer.from(s, "utf8")));
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });
});

describe("framing", () => {
  test("every frame fits the MTU write limit", () => {
    for (const mtu of [23, 100, 185, 517]) {
      const frames = encodeFrames(rand(3000), mtu);
      for (const f of frames) expect(f.length + 3).toBeLessThanOrEqual(mtu);
    }
  });

  test("reassembles in order, out of order and with duplicates", () => {
    const msg = rand(1500);
    const frames = encodeFrames(msg, 185, 0xabcd);

    const r1 = new Reassembler();
    let out = null;
    for (const f of frames) out = r1.push("peerA", f) || out;
    expect(Array.from(out)).toEqual(Array.from(msg));

    const r2 = new Reassembler();
    out = null;
    for (const f of [...frames].reverse()) {
      out = r2.push("peerA", f) || out;
      r2.push("peerA", f); // duplicate after delivery just starts a stale transfer
    }
    expect(Array.from(out)).toEqual(Array.from(msg));
  });

  test("single-frame message", () => {
    const frames = encodeFrames(rand(5), 185);
    expect(frames).toHaveLength(1);
    expect(Array.from(new Reassembler().push("a", frames[0]))).toEqual(Array.from(rand(5)));
  });

  test("interleaved transfers from different sources and ids stay separate", () => {
    const a = rand(400);
    const b = rand(400).map((x) => x ^ 0xff);
    const fa = encodeFrames(a, 100, 1);
    const fb = encodeFrames(b, 100, 1); // same transfer id, different source
    const fc = encodeFrames(b, 100, 2); // same source, different id
    const r = new Reassembler();
    const done = [];
    const feed = (src, f) => {
      const out = r.push(src, f);
      if (out) done.push([src, out]);
    };
    for (let i = 0; i < Math.max(fa.length, fb.length, fc.length); i++) {
      if (fa[i]) feed("A", fa[i]);
      if (fb[i]) feed("B", fb[i]);
      if (fc[i]) feed("A", fc[i]);
    }
    expect(done).toHaveLength(3);
    const byKey = Object.fromEntries(done.map(([s, o], i) => [i, [s, Array.from(o)]]));
    expect(Object.values(byKey).filter(([s]) => s === "A")).toHaveLength(2);
  });

  test("drops malformed frames", () => {
    const r = new Reassembler();
    expect(r.push("a", new Uint8Array([]))).toBeNull();
    expect(r.push("a", new Uint8Array(FRAME_HEADER_SIZE))).toBeNull(); // no payload
    const bad = encodeFrames(rand(10), 185)[0];
    bad[0] = 9; // unknown version
    expect(r.push("a", bad)).toBeNull();
    const oob = encodeFrames(rand(10), 185)[0];
    oob[4] = 5; // index >= total
    expect(r.push("a", oob)).toBeNull();
  });

  test("discards incomplete transfers after the timeout", () => {
    let t = 0;
    const r = new Reassembler({ timeoutMs: 1000, now: () => t });
    const frames = encodeFrames(rand(500), 100, 7);
    r.push("a", frames[0]);
    expect(r.transfers.size).toBe(1);
    t = 5000;
    r.push("a", frames[1]);
    // the stale transfer was pruned, then a fresh one started by frame 1
    expect(r.transfers.size).toBe(1);
    expect(r.push("a", frames[2])).toBeNull();
  });

  test("refuses oversized and empty messages", () => {
    expect(() => encodeFrames(new Uint8Array(0))).toThrow();
    expect(() => encodeFrames(new Uint8Array(MAX_MESSAGE_BYTES + 1), 517)).toThrow();
    expect(() => maxFramePayload(10)).toThrow();
  });
});
