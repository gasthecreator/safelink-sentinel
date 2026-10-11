// app/services/crypto/SecureStore.js
// Keychain/Keystore-backed storage for the device's private keys.
//
//   iOS      Keychain, "after first unlock, this device only": readable while the
//            phone is locked (the mesh runs in the background), never synced to
//            iCloud or restored onto another device.
//   Android  Android Keystore-backed encrypted storage.
//
// Where no secure storage exists (web, unit tests) it falls back to AsyncStorage
// and says so, so a dev build never silently pretends to be secure.

const SERVICE = "com.safelink.mesh.identity";
const ACCOUNT = "identity";
const FALLBACK_KEY = "@safelink_identity";

let AsyncStorage = global.AsyncStorage;
if (!AsyncStorage) {
  try {
    AsyncStorage = require("@react-native-async-storage/async-storage").default;
  } catch {
    AsyncStorage = {
      storage: {},
      async setItem(key, value) { this.storage[key] = value; },
      async getItem(key) { return this.storage[key] || null; },
      async removeItem(key) { delete this.storage[key]; },
    };
  }
}

function loadKeychain() {
  try {
    const { NativeModules } = require("react-native");
    if (!NativeModules.RNKeychainManager) return null; // module not linked in this build
    const Keychain = require("react-native-keychain");
    return Keychain && Keychain.getGenericPassword ? Keychain : null;
  } catch {
    return null;
  }
}

const Keychain = loadKeychain();
if (!Keychain) {
  console.log("[SafeLink] ⚠️ Secure storage unavailable - identity kept in AsyncStorage (web/dev only)");
}

/** True when private keys live in the OS keychain/keystore. */
export const isSecure = !!Keychain;

/** Returns the stored string, or null if there is none. Throws if the keychain itself fails. */
export async function getSecret() {
  if (!Keychain) return AsyncStorage.getItem(FALLBACK_KEY);
  const entry = await Keychain.getGenericPassword({ service: SERVICE });
  return entry ? entry.password : null;
}

export async function setSecret(value) {
  if (!Keychain) return AsyncStorage.setItem(FALLBACK_KEY, value);
  const result = await Keychain.setGenericPassword(ACCOUNT, value, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  if (!result) throw new Error("Keychain refused to store the identity");
}

export async function removeSecret() {
  if (!Keychain) return AsyncStorage.removeItem(FALLBACK_KEY);
  await Keychain.resetGenericPassword({ service: SERVICE });
}
