#!/usr/bin/env node
// Builds an offline routing pack for an area from OpenStreetMap.
//
//   node scripts/build-routing-pack.js --name "Grambling, LA" \
//        --bbox 32.505,-92.745,32.545,-92.690 --out assets/maps/grambling-la.json
//   node scripts/build-routing-pack.js --from saved-overpass.json --name X --out pack.json
//
// bbox is south,west,north,east in decimal degrees. Needs internet, once, on the
// machine that builds the pack (not on the phone). An area bigger than one small request is fetched
// in tiles, one at a time with a pause between them (the public Overpass servers are shared), and
// joined into a single pack. Finished tiles are kept in --cache (default: next to --out), so a run
// that fails part-way resumes where it stopped. Limit: 1 square degree (about 10,000 km2) per pack.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { osmToPack } = require("./lib/osmToPack");
const { splitBbox, mergeOverpass, MAX_TILE_AREA, MAX_TOTAL_AREA } = require("./lib/tiles");

const PAUSE_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const UA = "safelink-sentinel-pack-builder/1.0 (https://github.com/gasthecreator/safelink-sentinel)";

function post(url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "POST", headers: { "User-Agent": UA, Accept: "*/*", "Content-Type": "application/x-www-form-urlencoded" }, timeout: 120000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          res.statusCode === 200 ? resolve(text) : reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout from ${url}`)));
    req.on("error", reject);
    req.end(body);
  });
}

// The public servers are often briefly overloaded (502/504): try each, then wait and go round again.
async function fetchOverpass(box) {
  let lastError;
  for (let round = 0; round < 3; round++) {
    if (round > 0) {
      console.error(`  waiting ${round * 15}s before trying again...`);
      await sleep(round * 15000);
    }
    try {
      return await fetchOverpassOnce(box);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function fetchOverpassOnce([s, w, n, e]) {
  const query = `[out:json][timeout:90];way["highway"](${s},${w},${n},${e});(._;>;);out body;`;
  const body = `data=${encodeURIComponent(query)}`;
  let lastError;
  for (const url of ENDPOINTS) {
    try {
      const text = await post(url, body);
      if (text.trim().startsWith("{")) return JSON.parse(text);
      lastError = new Error(`unexpected response from ${url}`);
    } catch (err) {
      lastError = err;
      console.error(`  ${err.message}, trying the next server...`);
    }
  }
  throw lastError;
}

(async () => {
  const out = arg("out");
  const name = arg("name") || "Map pack";
  if (!out || (!arg("bbox") && !arg("from"))) {
    console.error('Usage: build-routing-pack.js --name "Place" (--bbox s,w,n,e | --from overpass.json) --out file.json');
    process.exit(2);
  }
  let osm;
  let bbox;
  if (arg("bbox")) {
    bbox = arg("bbox").split(",").map(Number);
    if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
      console.error("bbox must be south,west,north,east");
      process.exit(2);
    }
  }
  if (arg("from")) {
    osm = JSON.parse(fs.readFileSync(arg("from"), "utf8")); // bbox, if also given, is the covered area
  } else {
    const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    if (area > MAX_TOTAL_AREA) {
      console.error(`That area is ${area.toFixed(2)} square degrees; the limit is ${MAX_TOTAL_AREA} (about 10,000 km2, roughly 25 MB). Make several packs instead.`);
      process.exit(2);
    }
    const tiles = splitBbox(bbox, MAX_TILE_AREA);
    const cache = arg("cache") || `${out}.tiles`;
    fs.mkdirSync(cache, { recursive: true });
    console.log(`Fetching roads for ${name} ${bbox.join(",")} in ${tiles.length} tile${tiles.length === 1 ? "" : "s"} ...`);
    const parts = [];
    for (const [i, tile] of tiles.entries()) {
      const file = path.join(cache, `tile-${tile.map((v) => v.toFixed(6)).join("_")}.json`);
      if (fs.existsSync(file)) {
        try {
          parts.push(JSON.parse(fs.readFileSync(file, "utf8")));
          console.log(`  tile ${i + 1}/${tiles.length}: already fetched`);
          continue;
        } catch {
          // a half-written file: fetch it again
        }
      }
      if (i > 0 && parts.length > 0) await sleep(PAUSE_MS);
      console.log(`  tile ${i + 1}/${tiles.length}: ${tile.map((v) => v.toFixed(4)).join(",")}`);
      const part = await fetchOverpass(tile);
      fs.writeFileSync(file, JSON.stringify(part));
      parts.push(part);
    }
    osm = mergeOverpass(parts);
    if (!arg("keep-cache")) fs.rmSync(cache, { recursive: true, force: true });
  }
  const pack = osmToPack(osm, { name, bbox });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(pack));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`Wrote ${out}: ${pack.stats.nodes} points, ${pack.stats.edges} road segments, ${kb} KB`);
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
