#!/usr/bin/env node
// Makes the key pair that signs your map catalog.
//
//   node scripts/pack-keys.js --out ~/.safelink/pack-signing.key
//
// The PRIVATE key is written to that file (readable only by you) and never printed. The PUBLIC key
// is printed: put it in constants/maps.js as MAP_CATALOG_PUBLIC_KEY. Anyone with the private key can
// publish maps that every phone with that public key will trust, so keep it safe and back it up:
// if you lose it you must ship a new app build with a new public key.
//
//   node scripts/pack-keys.js --role backup   makes the BACKUP key: keep it offline (a USB stick in a drawer,
//   not this computer). It can retire the everyday key if that leaks.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { generateKeypair } = require("./lib/catalogSigner");

const i = process.argv.indexOf("--out");
const r = process.argv.indexOf("--role");
const backup = r > -1 && process.argv[r + 1] === "backup";
const out = i > -1 ? process.argv[i + 1] : path.join(os.homedir(), ".safelink", backup ? "pack-backup.key" : "pack-signing.key");

if (fs.existsSync(out)) {
  console.error(`Refusing to overwrite ${out}. Move it away first if you really want a new key.`);
  process.exit(1);
}
const { publicKey, secretKey } = generateKeypair();
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
fs.writeFileSync(out, secretKey + "\n", { mode: 0o600 });
console.log(`Private key written to ${out} (keep it secret, and back it up).`);
console.log("");
console.log(`Public key (put this in app/constants/maps.js as ${backup ? "MAP_CATALOG_BACKUP_PUBLIC_KEY" : "MAP_CATALOG_PUBLIC_KEY"}):`);
console.log(publicKey);
if (backup) {
  console.log("");
  console.log("Keep this file OFFLINE and away from the machine you publish maps from. Use it only to retire a leaked everyday key.");
}
