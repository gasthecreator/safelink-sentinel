// app/services/crypto/IdentityManager.js
// Per-device identity: an Ed25519 signing keypair and an X25519 (NaCl box)
// encryption keypair. The device ID is derived from the signing public key,
// so an ID can't be claimed without holding the matching private key.

import nacl from "tweetnacl";
import { bytesToBase64, base64ToBytes, bytesToHex } from "../ble/codec.js";

import { getSecret, setSecret, removeSecret, isSecure } from "./SecureStore.js";

// Before private keys moved to the keychain, the identity lived in AsyncStorage.
const LEGACY_STORAGE_KEY = "@safelink_identity";
const IDENTITY_VERSION = 2;

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

/** Stable, self-certifying device ID for a signing public key (base64). */
export function deriveDeviceId(signPublicKeyB64) {
  const digest = nacl.hash(base64ToBytes(signPublicKeyB64));
  return bytesToHex(digest.subarray(0, 16));
}

function parseIdentity(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.version === IDENTITY_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

class IdentityManager {
  constructor() {
    this.identity = null;
    this.loading = null;
  }

  // Concurrent callers (relay, envelopes, discovery all ask at startup) must
  // share one load, or two of them could each create a different identity.
  getOrCreateIdentity() {
    if (this.identity) return Promise.resolve(this.identity);
    if (!this.loading) {
      this.loading = this.loadOrCreate()
        .then((identity) => {
          this.identity = identity;
          return identity;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  async loadOrCreate() {
    let existing = null;
    try {
      existing = parseIdentity(await getSecret());
    } catch (error) {
      console.log(`[SafeLink] ❌ Could not read secure storage: ${error.message}`);
    }
    if (existing) {
      console.log("[SafeLink] 🆔 Loaded existing device identity");
      return existing;
    }

    // One-time move of an identity saved by an earlier build into the keychain.
    if (isSecure) {
      const legacy = parseIdentity(await AsyncStorage.getItem(LEGACY_STORAGE_KEY));
      if (legacy) {
        await setSecret(JSON.stringify(legacy));
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY); // only after the keychain write succeeded
        console.log("[SafeLink] 🆔 Moved device identity into the keychain");
        return legacy;
      }
    }

    const sign = nacl.sign.keyPair();
    const box = nacl.box.keyPair();
    const signPublic = bytesToBase64(sign.publicKey);
    const identity = {
      version: IDENTITY_VERSION,
      deviceId: deriveDeviceId(signPublic),
      signPublicKey: signPublic,
      signSecretKey: bytesToBase64(sign.secretKey),
      boxPublicKey: bytesToBase64(box.publicKey),
      boxSecretKey: bytesToBase64(box.secretKey),
    };
    await setSecret(JSON.stringify(identity));
    console.log("[SafeLink] 🆔 Created new device identity");
    return identity;
  }

  /**
   * Throw away this phone's identity (its private keys, in the keychain) so a new one is made the next
   * time it is needed. Other phones will see a new device.
   */
  async reset() {
    this.identity = null;
    this.loading = null;
    await removeSecret();
    try {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // there was no older copy
    }
  }

  async getDeviceId() {
    return (await this.getOrCreateIdentity()).deviceId;
  }

  // Alias used by the UI layer.
  async getMyId() {
    return this.getDeviceId();
  }

  /** Public profile other nodes learn when they connect to us. */
  async getPublicProfile() {
    const id = await this.getOrCreateIdentity();
    return { v: 1, id: id.deviceId, sign: id.signPublicKey, box: id.boxPublicKey };
  }

  /** Check that a received profile's ID really belongs to its signing key. */
  isValidProfile(profile) {
    try {
      return (
        !!profile &&
        typeof profile.id === "string" &&
        typeof profile.sign === "string" &&
        typeof profile.box === "string" &&
        base64ToBytes(profile.sign).length === nacl.sign.publicKeyLength &&
        base64ToBytes(profile.box).length === nacl.box.publicKeyLength &&
        deriveDeviceId(profile.sign) === profile.id
      );
    } catch {
      return false;
    }
  }

  async signBytes(bytes) {
    const { signSecretKey } = await this.getOrCreateIdentity();
    return bytesToBase64(nacl.sign.detached(bytes, base64ToBytes(signSecretKey)));
  }

  verifyBytes(signPublicKeyB64, bytes, signatureB64) {
    try {
      return nacl.sign.detached.verify(
        bytes,
        base64ToBytes(signatureB64),
        base64ToBytes(signPublicKeyB64)
      );
    } catch {
      return false;
    }
  }

  /** NaCl box (X25519 + XSalsa20-Poly1305) from us to `recipientBoxPublicKeyB64`. */
  async encryptFor(recipientBoxPublicKeyB64, plainBytes) {
    const { boxSecretKey } = await this.getOrCreateIdentity();
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const cipher = nacl.box(
      plainBytes,
      nonce,
      base64ToBytes(recipientBoxPublicKeyB64),
      base64ToBytes(boxSecretKey)
    );
    return { n: bytesToBase64(nonce), c: bytesToBase64(cipher) };
  }

  /** Returns plaintext bytes, or null if it wasn't sealed to us by that sender. */
  async decryptFrom(senderBoxPublicKeyB64, sealed) {
    try {
      const { boxSecretKey } = await this.getOrCreateIdentity();
      return nacl.box.open(
        base64ToBytes(sealed.c),
        base64ToBytes(sealed.n),
        base64ToBytes(senderBoxPublicKeyB64),
        base64ToBytes(boxSecretKey)
      );
    } catch {
      return null;
    }
  }
}

export default new IdentityManager();
