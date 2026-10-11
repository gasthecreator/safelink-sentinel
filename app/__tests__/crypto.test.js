const makeStorage = () => ({
  data: {},
  async getItem(k) { return this.data[k] ?? null; },
  async setItem(k, v) { this.data[k] = v; },
  async removeItem(k) { delete this.data[k]; },
});

// Load a fully isolated "device": its own storage and its own identity singleton.
function newDevice() {
  const storage = makeStorage();
  let device;
  jest.isolateModules(() => {
    global.AsyncStorage = storage;
    device = {
      storage,
      Id: require("../services/crypto/IdentityManager.js"),
      Env: require("../services/crypto/Envelope.js"),
    };
  });
  return device;
}

let alice, bob, mallory;
beforeAll(async () => {
  alice = newDevice();
  bob = newDevice();
  mallory = newDevice();
  for (const d of [alice, bob, mallory]) d.profile = await d.Id.default.getPublicProfile();
});
afterAll(() => { delete global.AsyncStorage; });

describe("identity", () => {
  test("ids are derived from the signing key and unique per device", () => {
    expect(alice.profile.id).toMatch(/^[0-9a-f]{32}$/);
    expect(alice.Id.deriveDeviceId(alice.profile.sign)).toBe(alice.profile.id);
    expect(new Set([alice.profile.id, bob.profile.id, mallory.profile.id]).size).toBe(3);
  });

  test("identity persists across restarts", async () => {
    const stored = alice.storage.data["@safelink_identity"];
    expect(stored).toBeTruthy();
    alice.Id.default.identity = null; // simulate a fresh process reading storage
    expect((await alice.Id.default.getPublicProfile()).id).toBe(alice.profile.id);
  });

  test("a legacy (pre-keypair) identity is replaced, not crashed on", async () => {
    const dev = newDevice();
    dev.storage.data["@safelink_identity"] = JSON.stringify({ deviceId: "x", signingKey: "y" });
    const p = await dev.Id.default.getPublicProfile();
    expect(dev.Id.default.isValidProfile(p)).toBe(true);
  });

  test("profile validation rejects an ID that doesn't match its key", () => {
    const I = alice.Id.default;
    expect(I.isValidProfile(alice.profile)).toBe(true);
    expect(I.isValidProfile({ ...alice.profile, id: bob.profile.id })).toBe(false);
    expect(I.isValidProfile({ ...alice.profile, sign: bob.profile.sign })).toBe(false);
    expect(I.isValidProfile({ ...alice.profile, box: "AAAA" })).toBe(false);
    expect(I.isValidProfile(null)).toBe(false);
  });
});

describe("envelopes", () => {
  const direct = () =>
    alice.Env.createEnvelope({
      id: "m1",
      content: "Need water at the school 🚑",
      meta: { priority: "high" },
      to: bob.profile.id,
      recipientBoxKey: bob.profile.box,
    });

  test("direct message: only the recipient can read it", async () => {
    const env = await direct();
    expect(env.type).toBe("direct");
    expect(env.body).not.toContain("water");
    expect(alice.Env.verifyEnvelope(env)).toBe(true);
    expect(await bob.Env.openEnvelope(env)).toEqual({
      content: "Need water at the school 🚑",
      meta: { priority: "high" },
    });
    expect(await mallory.Env.openEnvelope(env)).toBeNull();
  });

  test("survives wire encoding", async () => {
    const env = await direct();
    const round = bob.Env.decodeEnvelope(bob.Env.encodeEnvelope(env));
    expect(bob.Env.verifyEnvelope(round)).toBe(true);
    expect((await bob.Env.openEnvelope(round)).content).toContain("water");
  });

  test("broadcast is readable by anyone but still signed", async () => {
    const env = await alice.Env.createEnvelope({ id: "b1", content: "Flooding on 5th St", meta: {} });
    expect(env.type).toBe("broadcast");
    expect(mallory.Env.verifyEnvelope(env)).toBe(true);
    expect((await mallory.Env.openEnvelope(env)).content).toBe("Flooding on 5th St");
  });

  test("tampering with any signed field is rejected", async () => {
    const env = await alice.Env.createEnvelope({ id: "b2", content: "All clear", meta: {} });
    for (const patch of [
      { body: JSON.stringify({ content: "Evacuate", meta: {} }) },
      { id: "other" },
      { ts: "2000-01-01T00:00:00.000Z" },
      { ttl: 9 },
      { to: bob.profile.id },
      { type: "direct" },
    ]) {
      expect(bob.Env.verifyEnvelope({ ...env, ...patch })).toBe(false);
    }
  });

  test("hops is the only mutable field (relays may bump it)", async () => {
    const env = await direct();
    expect(bob.Env.verifyEnvelope({ ...env, hops: 3 })).toBe(true);
  });

  test("impersonation fails: swapping in another node's id or keys", async () => {
    const env = await alice.Env.createEnvelope({ id: "b3", content: "hi", meta: {} });
    expect(bob.Env.verifyEnvelope({ ...env, from: bob.profile.id })).toBe(false);
    expect(
      bob.Env.verifyEnvelope({ ...env, from: mallory.profile.id, fromSign: mallory.profile.sign })
    ).toBe(false); // signature was made by alice's key
    // re-signing under mallory's own identity is just a valid message *from mallory*
    const forged = await mallory.Env.createEnvelope({ id: "b3", content: "hi", meta: {} });
    expect(forged.from).toBe(mallory.profile.id);
  });

  test("a swapped encryption key can't be smuggled in", async () => {
    const env = await direct();
    expect(bob.Env.verifyEnvelope({ ...env, fromBox: mallory.profile.box })).toBe(false);
  });

  test("direct send without a recipient key fails loudly", async () => {
    await expect(
      alice.Env.createEnvelope({ id: "x", content: "hi", to: bob.profile.id })
    ).rejects.toThrow(/No encryption key/);
  });

  test("rejects malformed envelopes", () => {
    const v = alice.Env.verifyEnvelope;
    expect(v(null)).toBe(false);
    expect(v({})).toBe(false);
    expect(v({ v: 1, id: 1 })).toBe(false);
    expect(alice.Env.decodeEnvelope(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
