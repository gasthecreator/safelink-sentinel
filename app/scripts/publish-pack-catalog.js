#!/usr/bin/env node
// Turns finished map packs into files ready to put on a web server: a signed catalog plus the packs.
//
//   node scripts/publish-pack-catalog.js --key ~/.safelink/pack-signing.key \
//        --base-url https://example.com/maps --out dist/maps  assets/maps/grambling-la.json ...
//
// Each pack file's name (without .json) is its id. Re-run with the same --out to publish an update:
// the catalog's sequence goes up, and only packs whose content changed get a new version.
// This only writes files into --out; uploading them (to a GitHub release, a bucket, any HTTPS host)
// is up to you. The catalog goes at the URL set as MAP_CATALOG_URL in app/constants/maps.js.

const fs = require("fs");
const path = require("path");
const { signCatalog, buildBody } = require("./lib/catalogSigner");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const files = process.argv.slice(2).filter((a, i, all) => a.endsWith(".json") && !all[i - 1]?.startsWith("--"));

const keyFile = arg("key");
const baseUrl = arg("base-url");
const out = arg("out");
if (!keyFile || !baseUrl || !out || files.length === 0) {
  console.error("Usage: publish-pack-catalog.js --key KEYFILE --base-url https://host/path --out DIR pack.json [pack.json ...]");
  process.exit(2);
}

const secretKey = fs.readFileSync(keyFile, "utf8").trim();
fs.mkdirSync(out, { recursive: true });

let previous = null;
const catalogPath = path.join(out, "catalog.json");
if (fs.existsSync(catalogPath)) previous = JSON.parse(JSON.parse(fs.readFileSync(catalogPath, "utf8")).body);

const packs = files.map((file) => {
  const id = path.basename(file, ".json");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    console.error(`"${id}" is not a valid map id (lower-case letters, digits and dashes). Rename ${file}.`);
    process.exit(2);
  }
  const buffer = fs.readFileSync(file);
  const pack = JSON.parse(buffer.toString("utf8"));
  if (pack.format !== 1 || !Array.isArray(pack.bbox) || !pack.name) {
    console.error(`${file} does not look like a routing pack (build it with build-routing-pack.js).`);
    process.exit(2);
  }
  return { id, buffer, pack };
});

const body = buildBody({ previous, packs, baseUrl });
for (const entry of body.packs) {
  const source = packs.find((p) => p.id === entry.id);
  fs.writeFileSync(path.join(out, `${entry.id}-v${entry.version}.json`), source.buffer);
}
fs.writeFileSync(catalogPath, JSON.stringify(signCatalog(body, secretKey)));

console.log(`Catalog sequence ${body.sequence} written to ${catalogPath}`);
for (const e of body.packs) console.log(`  ${e.id} v${e.version}  ${(e.sizeBytes / 1024).toFixed(0)} KB  ${e.url}`);
console.log(`Upload everything in ${out} to ${baseUrl}`);
