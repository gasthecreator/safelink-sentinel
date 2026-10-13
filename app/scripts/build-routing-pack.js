#!/usr/bin/env node
// Builds an offline routing pack for an area from OpenStreetMap.
//
//   node scripts/build-routing-pack.js --name "Grambling, LA" \
//        --bbox 32.505,-92.745,32.545,-92.690 --out assets/maps/grambling-la.json
//   node scripts/build-routing-pack.js --from saved-overpass.json --name X --out pack.json
//
// bbox is south,west,north,east in decimal degrees. Needs internet, once, on the
// machine that builds the pack (not on the phone). Be gentle with the public Overpass
// servers: ask for small areas, one at a time. Large regions should use a Geofabrik
// extract instead; this script only handles an Overpass JSON file or a small bbox.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { osmToPack } = require("./lib/osmToPack");

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

async function fetchOverpass([s, w, n, e]) {
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
    if (area > 0.25) {
      console.error("That area is too large for the public Overpass servers. Use a Geofabrik extract for big regions.");
      process.exit(2);
    }
    console.log(`Fetching roads for ${name} ${bbox.join(",")} ...`);
    osm = await fetchOverpass(bbox);
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
