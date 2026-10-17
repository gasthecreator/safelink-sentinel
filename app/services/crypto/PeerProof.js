// app/services/crypto/PeerProof.js
// Proof that a nearby phone really holds the private key behind the identity it advertises.
//
// A phone's public profile (its ID and public keys) is readable by anyone in range, so anyone can copy it and
// advertise "I am Maria". The check: the verifier picks a fresh random nonce; the phone being checked signs
// (domain, nonce, its own ID) with its identity key; the verifier checks that signature against the public key
// in the profile. A copied profile cannot produce it, and a recorded proof is useless because the next
// verifier's nonce is different. The domain keeps these signatures from being usable as message signatures.

import nacl from "tweetnacl";
import IdentityManager from "./IdentityManager.js";
import { bytesToBase64, utf8Encode } from "../ble/codec.js";
import { CHALLENGE_BYTES } from "../ble/BleProtocol.js";

const PROOF_DOMAIN = "safelink/proof/1";

export function newNonce() {
  return nacl.randomBytes(CHALLENGE_BYTES);
}

function proofBytes(nonceB64, id) {
  return utf8Encode(JSON.stringify([PROOF_DOMAIN, nonceB64, id]));
}

/** Answer a challenge: { n, s } = the nonce and our signature over it. */
export async function signProof(nonce) {
  const id = await IdentityManager.getDeviceId();
  const n = bytesToBase64(nonce);
  return { n, s: await IdentityManager.signBytes(proofBytes(n, id)) };
}

/** True only if `proof` answers THIS nonce and was signed by the key in `profile`, whose id it matches. */
export function verifyProof(profile, nonce, proof) {
  try {
    if (!IdentityManager.isValidProfile(profile)) return false;
    if (!proof || typeof proof.n !== "string" || typeof proof.s !== "string") return false;
    if (proof.n !== bytesToBase64(nonce)) return false;
    return IdentityManager.verifyBytes(profile.sign, proofBytes(proof.n, profile.id), proof.s);
  } catch {
    return false;
  }
}
