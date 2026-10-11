// IdentityManager with a (mocked) OS keychain present, as on a real device.

function makeEnv({ keychainBroken = false } = {}) {
  const keychain = { entries: {}, sets: 0 };
  const asyncStore = {};
  let mod;
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ NativeModules: { RNKeychainManager: {} } }));
    jest.doMock("react-native-keychain", () => ({
      ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "AfterFirstUnlockThisDeviceOnly" },
      async getGenericPassword({ service }) {
        if (keychainBroken === "read") throw new Error("keystore unavailable");
        const e = keychain.entries[service];
        return e ? { username: e.username, password: e.password, service } : false;
      },
      async setGenericPassword(username, password, opts) {
        if (keychainBroken === "write") throw new Error("keystore write failed");
        keychain.sets += 1;
        keychain.entries[opts.service] = { username, password, accessible: opts.accessible };
        return { service: opts.service };
      },
      async resetGenericPassword({ service }) {
        delete keychain.entries[service];
        return true;
      },
    }));
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: {
        getItem: async (k) => asyncStore[k] ?? null,
        setItem: async (k, v) => { asyncStore[k] = v; },
        removeItem: async (k) => { delete asyncStore[k]; },
      },
    }));
    global.AsyncStorage = undefined;
    mod = {
      Id: require("../services/crypto/IdentityManager.js").default,
      SecureStore: require("../services/crypto/SecureStore.js"),
    };
  });
  return { keychain, asyncStore, ...mod };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("secure storage is detected", () => {
  expect(makeEnv().SecureStore.isSecure).toBe(true);
});

test("a new identity is written to the keychain and never to AsyncStorage", async () => {
  const env = makeEnv();
  const profile = await env.Id.getPublicProfile();
  expect(profile.id).toMatch(/^[0-9a-f]{32}$/);

  const entry = Object.values(env.keychain.entries)[0];
  expect(JSON.parse(entry.password).signSecretKey).toBeTruthy();
  expect(entry.accessible).toBe("AfterFirstUnlockThisDeviceOnly"); // readable in background, not synced
  expect(env.asyncStore).toEqual({}); // no secret keys in AsyncStorage
});

test("a restart loads the same identity from the keychain", async () => {
  const env = makeEnv();
  const first = await env.Id.getPublicProfile();
  env.Id.identity = null; // fresh process, same keychain
  const again = await env.Id.getPublicProfile();
  expect(again.id).toBe(first.id);
  expect(env.keychain.sets).toBe(1); // loaded, not regenerated
});

test("concurrent first callers share one identity", async () => {
  const env = makeEnv();
  const ids = await Promise.all(Array.from({ length: 10 }, () => env.Id.getDeviceId()));
  expect(new Set(ids).size).toBe(1);
  expect(env.keychain.sets).toBe(1);
});

test("an identity saved in AsyncStorage by an earlier build moves into the keychain", async () => {
  const env = makeEnv();
  // create an identity in a throwaway env, then plant it where the old build kept it
  const donor = makeEnv();
  const donorProfile = await donor.Id.getPublicProfile();
  const legacyJson = Object.values(donor.keychain.entries)[0].password;
  env.asyncStore["@safelink_identity"] = legacyJson;

  expect((await env.Id.getPublicProfile()).id).toBe(donorProfile.id); // identity preserved
  expect(Object.values(env.keychain.entries)[0].password).toBe(legacyJson);
  expect(env.asyncStore["@safelink_identity"]).toBeUndefined(); // secrets removed from AsyncStorage
});

test("if the keychain write fails, the legacy identity is NOT deleted", async () => {
  const env = makeEnv({ keychainBroken: "write" });
  const donor = makeEnv();
  await donor.Id.getPublicProfile();
  const legacyJson = Object.values(donor.keychain.entries)[0].password;
  env.asyncStore["@safelink_identity"] = legacyJson;

  await expect(env.Id.getPublicProfile()).rejects.toThrow(/keystore write failed/);
  expect(env.asyncStore["@safelink_identity"]).toBe(legacyJson); // still recoverable
});

test("a keychain read error is logged and doesn't crash the app", async () => {
  const env = makeEnv({ keychainBroken: "read" });
  // reading fails, so a new identity is created (and the write also hits the broken read path only)
  const profile = await env.Id.getPublicProfile();
  expect(env.Id.isValidProfile(profile)).toBe(true);
});

test("signing and decryption still work with keychain-held keys", async () => {
  const env = makeEnv();
  const sig = await env.Id.signBytes(new Uint8Array([1, 2, 3]));
  const { sign } = await env.Id.getPublicProfile();
  expect(env.Id.verifyBytes(sign, new Uint8Array([1, 2, 3]), sig)).toBe(true);
  expect(env.Id.verifyBytes(sign, new Uint8Array([9, 9, 9]), sig)).toBe(false);
});
