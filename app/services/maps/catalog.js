// app/services/maps/catalog.js
// The signed list of map packs. Pure logic: verify the signature, validate every field, and
// refuse a catalog older than one this phone has already seen.
//
// Wire format (what is hosted at the catalog URL):
//   { "format": 1, "body": "<JSON text>", "signature": "<base64 Ed25519 over the UTF-8 of body>" }
// The signature covers the exact text of `body`, so there is no JSON canonicalisation to get wrong.
// body = { "sequence": 7, "generatedAt": "<ISO>", "packs": [ { id, name, version, bbox, sizeBytes,
//          sha256, url, builtAt, attribution } ] }
//
// Why this much care: a pack tells the phone where roads are. One swapped in by someone who
// compromised the web host, or an old catalog replayed to bring back a known-bad pack, could send
// people the wrong way. The signature stops the first; the sequence number stops the second.

import nacl from "tweetnacl";
import { base64ToBytes, utf8Encode } from "../ble/codec.js";
import { sanitizeText } from "../location/position.js";
import { MAX_CATALOG_BYTES, MAX_PACK_BYTES } from "../../constants/maps.js";

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/; // also safe to use in a file name
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PACKS = 200;

export class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new CatalogError(code, message);
};

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function validBbox(b) {
  return (
    Array.isArray(b) && b.length === 4 && b.every(finite) &&
    b[0] >= -90 && b[2] <= 90 && b[1] >= -180 && b[3] <= 180 && b[0] < b[2] && b[1] < b[3]
  );
}

function cleanUrl(url, allowInsecure) {
  if (typeof url !== "string" || url.length > 500) return null;
  const m = url.match(/^(https?):\/\/([^/?#]+)(.*)$/i);
  if (!m) return null;
  if (m[1].toLowerCase() === "http" && !allowInsecure) return null;
  if (m[2].includes("@")) return null; // no credentials hidden in the address
  return url;
}

function cleanEntry(e, allowInsecure) {
  if (!e || typeof e !== "object") return null;
  if (typeof e.id !== "string" || !ID_PATTERN.test(e.id)) return null;
  const name = sanitizeText(e.name, 80);
  if (!name) return null;
  if (!Number.isInteger(e.version) || e.version < 1 || e.version > 1e6) return null;
  if (!validBbox(e.bbox)) return null;
  if (!Number.isInteger(e.sizeBytes) || e.sizeBytes < 1 || e.sizeBytes > MAX_PACK_BYTES) return null;
  if (typeof e.sha256 !== "string" || !SHA256_PATTERN.test(e.sha256)) return null;
  const url = cleanUrl(e.url, allowInsecure);
  if (!url) return null;
  return {
    id: e.id,
    name,
    version: e.version,
    bbox: e.bbox.slice(),
    sizeBytes: e.sizeBytes,
    sha256: e.sha256,
    url,
    builtAt: typeof e.builtAt === "string" ? e.builtAt.slice(0, 40) : null,
    attribution: sanitizeText(e.attribution, 200) || "© OpenStreetMap contributors",
  };
}

function parseKey(b64) {
  try {
    const key = base64ToBytes(b64);
    return key.length === nacl.sign.publicKeyLength ? key : null;
  } catch {
    return null;
  }
}

const MAX_RETIRE = 8;

/**
 * Verify and read a catalog.
 *
 * Two publisher keys are trusted: the everyday one, and a backup kept offline. Either can sign a
 * catalog. Only the backup can RETIRE a key (stop phones trusting it), which is how a leaked everyday
 * key is dealt with without shipping a new app. The backup itself cannot be retired this way.
 *
 * @param {object} wire  the parsed catalog file { format, body, signature }
 * @param {{publicKey: string, backupPublicKey?: string, retiredKeys?: string[], lastSequence?: number,
 *          allowInsecure?: boolean, now?: number}} options
 * @returns {{sequence:number, generatedAt:string, packs:object[], signedBy:"primary"|"backup", retire:string[]}}
 * @throws {CatalogError} with a code: no_key | malformed | bad_signature | stale | invalid
 */
export function verifyCatalog(wire, { publicKey, backupPublicKey = "", retiredKeys = [], lastSequence = 0, allowInsecure = false, now = Date.now() } = {}) {
  if (!publicKey) fail("no_key", "Map downloads are not set up in this build (no publisher key).");

  const retired = new Set(retiredKeys);
  const primary = parseKey(publicKey);
  if (!primary) fail("no_key", "The publisher key in this build is not valid.");
  const backup = backupPublicKey ? parseKey(backupPublicKey) : null;
  const candidates = [];
  if (!retired.has(publicKey)) candidates.push({ role: "primary", key: primary });
  if (backup && !retired.has(backupPublicKey)) candidates.push({ role: "backup", key: backup });
  if (candidates.length === 0) fail("no_key", "None of this build's publisher keys can be trusted any more. Update the app.");

  if (!wire || typeof wire !== "object" || wire.format !== 1 || typeof wire.body !== "string" || typeof wire.signature !== "string") {
    fail("malformed", "The map list is not in a format this app understands.");
  }
  if (wire.body.length > MAX_CATALOG_BYTES) fail("malformed", "The map list is too large.");

  let signature;
  try {
    signature = base64ToBytes(wire.signature);
  } catch {
    signature = null;
  }
  if (!signature || signature.length !== nacl.sign.signatureLength) fail("bad_signature", "The map list's signature is not valid, so it was not used.");
  // Verify BEFORE reading anything inside the body.
  const bodyBytes = utf8Encode(wire.body);
  const signer = candidates.find((c) => nacl.sign.detached.verify(bodyBytes, signature, c.key));
  if (!signer) fail("bad_signature", "The map list's signature is not valid, so it was not used.");

  let body;
  try {
    body = JSON.parse(wire.body);
  } catch {
    fail("malformed", "The map list could not be read.");
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.packs)) fail("malformed", "The map list could not be read.");
  if (!Number.isInteger(body.sequence) || body.sequence < 1) fail("malformed", "The map list has no valid version number.");

  // Rollback protection: a catalog older than one already seen is refused, even though it is
  // genuinely signed (it could list a pack the publisher has since withdrawn).
  if (body.sequence < lastSequence) {
    fail("stale", "This map list is older than one this phone has already seen, so it was not used.");
  }

  const generated = Date.parse(body.generatedAt);
  if (!Number.isFinite(generated) || generated > now + 24 * 3600 * 1000) fail("malformed", "The map list has an invalid date.");
  if (body.packs.length > MAX_PACKS) fail("malformed", "The map list is too long.");

  const packs = [];
  const seen = new Set();
  for (const raw of body.packs) {
    const entry = cleanEntry(raw, allowInsecure);
    if (!entry) fail("invalid", "The map list contains an entry that is not valid, so none of it was used.");
    if (seen.has(entry.id)) fail("invalid", "The map list lists the same map twice, so none of it was used.");
    seen.add(entry.id);
    packs.push(entry);
  }
  // Retiring keys is the backup key's power alone: a stolen everyday key must not be able to
  // lock the real publisher out.
  const retire = [];
  if (signer.role === "backup" && Array.isArray(body.retire)) {
    for (const k of body.retire.slice(0, MAX_RETIRE)) {
      if (typeof k === "string" && k !== backupPublicKey && parseKey(k) && !retire.includes(k)) retire.push(k);
    }
  }
  return { sequence: body.sequence, generatedAt: body.generatedAt, packs, signedBy: signer.role, retire };
}
