// app/scripts/lib/catalogSigner.js
// Publisher side of the signed map catalog (the app side is services/maps/catalog.js).
// Runs on the publisher's computer, never on a phone. The private key never leaves it.

const crypto = require("crypto");
const nacl = require("tweetnacl");

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** A fresh signing key pair, as base64 strings. */
function generateKeypair() {
  const kp = nacl.sign.keyPair();
  return { publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
}

/** The wire file the phone fetches: the body text, and a signature over exactly that text. */
function signCatalog(body, secretKeyB64) {
  const secret = unb64(secretKeyB64);
  if (secret.length !== nacl.sign.secretKeyLength) throw new Error("That is not a valid signing key.");
  const text = JSON.stringify(body);
  const signature = nacl.sign.detached(new Uint8Array(Buffer.from(text, "utf8")), secret);
  return { format: 1, body: text, signature: b64(signature) };
}

/**
 * The catalog body for a set of pack files.
 * Each pack: { id, buffer (the file's bytes), pack (the parsed pack JSON) }.
 * Sequence goes up by one each time; a pack's version goes up only when its content changed, so
 * phones re-download only what is new. File names carry the version so they can be cached for ever.
 */
function buildBody({ previous = null, packs, baseUrl, now = new Date() }) {
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("The base URL must start with https://");
  const base = baseUrl.replace(/\/+$/, "");
  const before = new Map(((previous && previous.packs) || []).map((p) => [p.id, p]));
  const entries = packs.map(({ id, buffer, pack }) => {
    const sha256 = sha256Hex(buffer);
    const old = before.get(id);
    const version = !old ? 1 : old.sha256 === sha256 ? old.version : old.version + 1;
    return {
      id,
      name: pack.name,
      version,
      bbox: pack.bbox,
      sizeBytes: buffer.length,
      sha256,
      url: `${base}/${id}-v${version}.json`,
      builtAt: pack.builtAt || null,
      attribution: pack.attribution || "© OpenStreetMap contributors",
    };
  });
  return {
    sequence: ((previous && previous.sequence) || 0) + 1,
    generatedAt: now.toISOString(),
    packs: entries,
  };
}

module.exports = { generateKeypair, signCatalog, buildBody, sha256Hex };
