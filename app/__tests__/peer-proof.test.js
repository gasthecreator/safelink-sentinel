// Proof of identity between nearby phones: a fake Bluetooth radio connects real BleTransport / IdentityManager
// instances (one per phone) so the whole challenge-and-answer exchange runs, including an attacker copying a profile.

import { isVerified, decideClaim, VERIFIED_FOR_MS } from "../services/mesh/peerTrust.js";
import { encodeChallenge, decodeControl, encodeFrames, Reassembler, CHALLENGE_BYTES } from "../services/ble/BleProtocol.js";
import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from "../services/ble/codec.js";

const SERVICE = "7b3f6a10-5afe-4e1d-9a2c-5afe11c0de00";

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ---- a radio joining phones; each phone has the real transport and identity, with a fake GATT underneath
function makeRadio() {
  return { byBleId: new Map(), writes: [] };
}

function newPhone(radio, name, { supportsProof = true, behave = null, store = {} } = {}) {
  let phone;
  jest.isolateModules(() => {
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: {
        getItem: async (k) => store[k] ?? null,
        setItem: async (k, v) => { store[k] = v; },
        removeItem: async (k) => { delete store[k]; },
      },
    }));
    global.AsyncStorage = undefined;
    // the peripheral side of this phone: what others read, and who wrote to it
    const peripheral = {
      state: "stopped",
      linked: true,
      identity: null,
      listener: null,
      async start(profile) { this.identity = profile; this.state = "advertising"; },
      async updateIdentity(profile) { this.identity = profile; },
      async stop() { this.state = "stopped"; },
      onWrite(cb) { this.listener = cb; return { remove() {} }; },
    };
    jest.doMock("../services/ble/BlePeripheral.js", () => ({ __esModule: true, default: peripheral }));
    // the central side: connecting to another phone's address gives a GATT view of its peripheral
    const manager = {
      async connectToDevice(bleId) {
        const target = radio.byBleId.get(bleId);
        if (!target) throw new Error("device not found");
        const device = {
          mtu: 185,
          async discoverAllServicesAndCharacteristics() { return device; },
          async readCharacteristicForService(service, characteristic) {
            expect(service).toBe(SERVICE);
            return { value: bytesToBase64(utf8Encode(JSON.stringify(target.respondToRead())) ) };
          },
          async writeCharacteristicWithResponseForService(service, characteristic, b64) {
            radio.writes.push({ to: bleId, bytes: base64ToBytes(b64) });
            target.receiveWrite(name, base64ToBytes(b64));
          },
        };
        return device;
      },
      async cancelDeviceConnection() {},
    };
    jest.doMock("../services/ble/bleManager.js", () => ({ getBleManager: () => manager }));
    const Id = require("../services/crypto/IdentityManager.js").default;
    const BleTransport = require("../services/ble/BleTransport.js").default;
    phone = { name, Id, BleTransport, peripheral, store };
  });
  // what other phones get when they read or write to this one (an attacker overrides these)
  phone.respondToRead = () => (behave && behave.read ? behave.read(phone) : phone.peripheral.identity);
  phone.receiveWrite = (fromName, bytes) => {
    if (behave && behave.write) return behave.write(phone, fromName, bytes);
    if (!supportsProof && decodeControl(bytes)) return undefined; // an older build ignores control frames
    return phone.peripheral.listener && phone.peripheral.listener({ centralId: fromName, bytes });
  };
  return phone;
}

async function bootPhone(radio, name, bleId, options) {
  const phone = newPhone(radio, name, options);
  phone.id = await phone.Id.getDeviceId();
  // every simulated phone must be its own identity, or a "proof" test could pass because everyone shares one key
  if ([...radio.byBleId.values()].some((p) => p.id === phone.id)) throw new Error("two simulated phones share an identity");
  phone.bleId = bleId;
  radio.byBleId.set(bleId, phone);
  await phone.BleTransport.start();
  return phone;
}

// the proofs answer after a moment, as they do on a real phone; speed the clock so the tests are quick
const realSetTimeout = global.setTimeout;
const fast = () =>
  jest.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...a) => {
    if (ms <= 1000) { realSetTimeout(fn, 0, ...a); return 0; } // short pauses run at once; the 30 s operation timeout stays real
    return realSetTimeout(fn, ms, ...a);
  });

describe("control frames", () => {
  test("a challenge round-trips and ordinary frames are never mistaken for one", () => {
    const nonce = new Uint8Array(CHALLENGE_BYTES).map((_, i) => i + 1);
    const frame = encodeChallenge(nonce);
    expect(decodeControl(frame)).toEqual({ kind: "challenge", nonce });
    for (const f of encodeFrames(new Uint8Array(500).fill(9), 185)) expect(decodeControl(f)).toBeNull();
    expect(decodeControl(null)).toBeNull();
    expect(decodeControl(new Uint8Array([2, 9, 1, 2, 3]))).toBeNull(); // unknown kind
    expect(decodeControl(new Uint8Array([2, 1, 1, 2, 3]))).toBeNull(); // wrong length
    expect(() => encodeChallenge(new Uint8Array(3))).toThrow();
  });
  test("a phone running an older build drops a control frame without a trace", () => {
    const r = new Reassembler();
    expect(r.push("x", encodeChallenge(new Uint8Array(CHALLENGE_BYTES)))).toBeNull();
    expect(r.transfers.size).toBe(0);
  });
});

describe("the exchange between two real phones", () => {
  test("an honest phone proves who it is", async () => {
    fast();
    const radio = makeRadio();
    const alice = await bootPhone(radio, "alice", "AA:AA");
    const bob = await bootPhone(radio, "bob", "BB:BB");
    const profile = await alice.BleTransport.readProfile("BB:BB");
    expect(profile.id).toBe(bob.id);
    expect(profile.verified).toBe(true);
    expect(profile.proof).toBeUndefined(); // the proof is checked and dropped, not passed around
    expect(radio.writes).toHaveLength(1);
  });

  test("a phone running an older build is not an error: it comes back unverified", async () => {
    fast();
    const radio = makeRadio();
    const alice = await bootPhone(radio, "alice", "AA:AA");
    const old = await bootPhone(radio, "old", "OO:OO", { supportsProof: false });
    const profile = await alice.BleTransport.readProfile("OO:OO");
    expect(profile.id).toBe(old.id);
    expect(profile.verified).toBe(false);
  });

  test("a copy of Bob's profile that cannot answer is unverified", async () => {
    fast();
    const radio = makeRadio();
    const alice = await bootPhone(radio, "alice", "AA:AA");
    const bob = await bootPhone(radio, "bob", "BB:BB");
    await bootPhone(radio, "mallory", "MM:MM", { behave: { read: () => bob.peripheral.identity, write: () => undefined } });
    const profile = await alice.BleTransport.readProfile("MM:MM");
    expect(profile.id).toBe(bob.id); // it claims to be Bob...
    expect(profile.verified).toBe(false); // ...and cannot prove it
  });

  test("replaying a proof Bob gave someone else does not work: each challenge has its own nonce", async () => {
    fast();
    const radio = makeRadio();
    const alice = await bootPhone(radio, "alice", "AA:AA");
    const bob = await bootPhone(radio, "bob", "BB:BB");
    const carol = await bootPhone(radio, "carol", "CC:CC");
    await carol.BleTransport.readProfile("BB:BB"); // Bob answers Carol, and an eavesdropper records it
    const recorded = JSON.parse(JSON.stringify(bob.peripheral.identity));
    expect(recorded.proof).toBeTruthy();
    await bootPhone(radio, "mallory", "MM:MM", { behave: { read: () => recorded, write: () => undefined } });
    const profile = await alice.BleTransport.readProfile("MM:MM");
    expect(profile.verified).toBe(false);
  });

  test("a proof signed with someone else's key is refused even if it answers the right nonce", async () => {
    fast();
    const radio = makeRadio();
    const alice = await bootPhone(radio, "alice", "AA:AA");
    const bob = await bootPhone(radio, "bob", "BB:BB");
    // Mallory has her own key. She advertises Bob's profile but answers with a proof signed by herself.
    const proofFromMallory = (mallory, nonce) => {
      const n = bytesToBase64(nonce);
      return mallory.Id.signBytes(utf8Encode(JSON.stringify(["safelink/proof/1", n, bob.id]))).then((s) => ({ n, s }));
    };
    const mallory = await bootPhone(radio, "mallory", "MM:MM", {
      behave: {
        read: (self) => ({ ...bob.peripheral.identity, proof: self.lastProof }),
        write: async (self, from, bytes) => {
          const control = decodeControl(bytes);
          self.lastProof = control ? await proofFromMallory(self, control.nonce) : undefined;
        },
      },
    });
    const profile = await alice.BleTransport.readProfile("MM:MM");
    expect(profile.id).toBe(bob.id);
    expect(profile.verified).toBe(false);
  });

  test("a different identity answering is not accepted for the one that was read first", async () => {
    fast();
    const radio = makeRadio();
    const alice = await bootPhone(radio, "alice", "AA:AA");
    const bob = await bootPhone(radio, "bob", "BB:BB");
    const eve = await bootPhone(radio, "eve", "EE:EE");
    let reads = 0;
    // first read shows Bob's profile; after the challenge it shows Eve's (with Eve's genuine proof of Eve)
    await bootPhone(radio, "switcher", "SS:SS", {
      behave: {
        read: () => (reads++ === 0 ? bob.peripheral.identity : eve.peripheral.identity),
        write: (self, from, bytes) => eve.peripheral.listener({ centralId: from, bytes }),
      },
    });
    const profile = await alice.BleTransport.readProfile("SS:SS");
        expect(profile.id).toBe(bob.id);
    expect(profile.verified).toBe(false);
  });

  test("a flood of challenges costs a bounded number of signatures", async () => {
    fast();
    const radio = makeRadio();
    const bob = await bootPhone(radio, "bob", "BB:BB");
    const sign = jest.spyOn(bob.Id, "signBytes");
    for (let i = 0; i < 100; i++) bob.peripheral.listener({ centralId: "spam", bytes: encodeChallenge(new Uint8Array(CHALLENGE_BYTES).fill(i)) });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(sign.mock.calls.length).toBeLessThanOrEqual(30);
  });
});

describe("what a phone does with a claim (peerTrust)", () => {
  const now = 1_000_000;
  const verifiedPeer = { id: "bob", bleId: "BB:BB", verifiedAt: now - 1000 };

  test("a verified claim is always accepted, even at a new address (a phone legitimately changes address)", () => {
    expect(decideClaim(verifiedPeer, { bleId: "NEW", verified: true }, now)).toEqual({ action: "accept", verifiedAt: now });
    expect(decideClaim(null, { bleId: "X", verified: true }, now).action).toBe("accept");
  });
  test("an unverified claim to a verified id at another address is ignored", () => {
    expect(decideClaim(verifiedPeer, { bleId: "MM:MM", verified: false }, now).action).toBe("ignore");
  });
  test("the same device failing to answer once keeps its earlier proof while it is fresh", () => {
    expect(decideClaim(verifiedPeer, { bleId: "BB:BB", verified: false }, now)).toEqual({ action: "accept", verifiedAt: verifiedPeer.verifiedAt });
  });
  test("once the proof is old, an unverified claim from anywhere is just an unverified claim", () => {
    const stale = { ...verifiedPeer, verifiedAt: now - VERIFIED_FOR_MS - 1 };
    expect(decideClaim(stale, { bleId: "MM:MM", verified: false }, now)).toEqual({ action: "accept", verifiedAt: null });
  });
  test("a brand new unverified device is recorded, as unverified", () => {
    expect(decideClaim(null, { bleId: "OO:OO", verified: false }, now)).toEqual({ action: "accept", verifiedAt: null });
  });
  test("isVerified needs a recent proof AND an address", () => {
    expect(isVerified(verifiedPeer, now)).toBe(true);
    expect(isVerified({ ...verifiedPeer, bleId: undefined }, now)).toBe(false);
    expect(isVerified({ ...verifiedPeer, verifiedAt: now - VERIFIED_FOR_MS }, now)).toBe(false);
    expect(isVerified({ id: "x", bleId: "A" }, now)).toBe(false);
    expect(isVerified(null, now)).toBe(false);
  });
});
