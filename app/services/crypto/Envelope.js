// app/services/crypto/Envelope.js
// Signed, optionally encrypted message envelope carried over BLE.
//
//   direct    body = {n, c}: content sealed to the recipient's box key
//   broadcast body = {content, meta} in the clear (alerts anyone nearby may read)
//
// Everything except `hops` (which relays bump) is covered by the sender's
// Ed25519 signature, and `from` must be derived from `fromSign`, so a relay
// can neither alter a message nor impersonate another node.

import IdentityManager, { deriveDeviceId } from "./IdentityManager.js";
import { utf8Encode, utf8Decode } from "../ble/codec.js";

export const ENVELOPE_VERSION = 1;
export const DEFAULT_TTL = 4;
const SIGN_DOMAIN = "safelink/1";
const MAX_FIELD_LENGTH = 100 * 1024;

function signedBytes(env) {
  return utf8Encode(
    JSON.stringify([
      SIGN_DOMAIN,
      env.v,
      env.id,
      env.type,
      env.from,
      env.fromSign,
      env.fromBox,
      env.to,
      env.ts,
      env.ttl,
      env.body,
    ])
  );
}

export async function createEnvelope({
  id,
  content,
  meta = {},
  to = null,
  recipientBoxKey = null,
  ttl = DEFAULT_TTL,
}) {
  const profile = await IdentityManager.getPublicProfile();
  const plain = JSON.stringify({ content, meta });

  let type = "broadcast";
  let body = plain;
  if (to) {
    if (!recipientBoxKey) throw new Error(`No encryption key known for ${to}`);
    type = "direct";
    body = JSON.stringify(await IdentityManager.encryptFor(recipientBoxKey, utf8Encode(plain)));
  }

  const env = {
    v: ENVELOPE_VERSION,
    id,
    type,
    from: profile.id,
    fromSign: profile.sign,
    fromBox: profile.box,
    to,
    ts: new Date().toISOString(),
    ttl,
    hops: 0,
    body,
  };
  env.sig = await IdentityManager.signBytes(signedBytes(env));
  return env;
}

/** Structure, ID-binding and signature check. Does not decrypt. */
export function verifyEnvelope(env) {
  if (!env || env.v !== ENVELOPE_VERSION) return false;
  const strings = ["id", "type", "from", "fromSign", "fromBox", "ts", "body", "sig"];
  for (const key of strings) {
    if (typeof env[key] !== "string" || env[key].length > MAX_FIELD_LENGTH) return false;
  }
  if (env.type !== "direct" && env.type !== "broadcast") return false;
  if (env.type === "direct" && typeof env.to !== "string") return false;
  if (!Number.isInteger(env.ttl) || env.ttl < 0 || env.ttl > 16) return false;
  try {
    if (deriveDeviceId(env.fromSign) !== env.from) return false;
  } catch {
    return false;
  }
  return IdentityManager.verifyBytes(env.fromSign, signedBytes(env), env.sig);
}

/** Returns {content, meta}, or null if this node can't read the envelope. */
export async function openEnvelope(env) {
  try {
    if (env.type === "broadcast") return JSON.parse(env.body);
    const myId = await IdentityManager.getDeviceId();
    if (env.to !== myId) return null;
    const plain = await IdentityManager.decryptFrom(env.fromBox, JSON.parse(env.body));
    return plain ? JSON.parse(utf8Decode(plain)) : null;
  } catch {
    return null;
  }
}

export function encodeEnvelope(env) {
  return utf8Encode(JSON.stringify(env));
}

export function decodeEnvelope(bytes) {
  try {
    return JSON.parse(utf8Decode(bytes));
  } catch {
    return null;
  }
}
