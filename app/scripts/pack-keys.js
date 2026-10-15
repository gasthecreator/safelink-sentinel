#!/usr/bin/env node
// Makes the key pair that signs your map catalog.
//
//   node scripts/pack-keys.js --out ~/.safelink/pack-signing.key
//
// The PRIVATE key is written to that file (readable only by you) and never printed. The PUBLIC key
// is printed: put it in constants/maps.js as MAP_CATALOG_PUBLIC_KEY. Anyone with the private key can
// publish maps that every phone with that public key will trust, so keep it safe and back it up:
// if you lose it you must ship a new app build with a new public key.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { generateKeypair } = require("./lib/catalogSigner");

const i = process.argv.indexOf("--out");
const out = i > -1 ? process.argv[i + 1] : path.join(os.homedir(), ".safelink", "pack-signing.key");

if (fs.existsSync(out)) {
  console.error(`Refusing to overwrite ${out}. Move it away first if you really want a new key.`);
  process.exit(1);
}
const { publicKey, secretKey } = generateKeypair();
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
fs.writeFileSync(out, secretKey + "\n", { mode: 0o600 });
console.log(`Private key written to ${out} (keep it secret, and back it up).`);
console.log("");
console.log("Public key (put this in app/constants/maps.js as MAP_CATALOG_PUBLIC_KEY):");
console.log(publicKey);
