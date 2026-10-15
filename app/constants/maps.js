// app/constants/maps.js
// Where offline map packs are downloaded from, and who is trusted to publish them.
//
// Packs decide where people are sent, so the list of packs (the catalog) is signed by the
// publisher and the app refuses anything that does not verify against the key below. With no
// key set, downloads are switched off (fail closed). See docs/OFFLINE_MAPS.md for how to make
// a key and publish a catalog.

// The signed catalog. A catalog is a small JSON file; the packs it lists are separate files.
export const MAP_CATALOG_URL =
  "https://github.com/gasthecreator/safelink-sentinel/releases/download/map-packs/catalog.json";

// The publisher's public key (base64, 32 bytes). Generate with: node scripts/pack-keys.js
// Leave empty to turn downloads off.
export const MAP_CATALOG_PUBLIC_KEY = "4XcMeHG3Rj4p+ZyvtzUvL/aYKGw5z/fuLJL2a6egUE4=";

// Only https:// downloads are allowed. This exists so tests and local development can use http.
export const ALLOW_INSECURE_PACK_URLS = false;

// Limits so a bad catalog cannot make the phone fetch something absurd.
export const MAX_CATALOG_BYTES = 1024 * 1024;
export const MAX_PACK_BYTES = 120 * 1024 * 1024;
export const CONFIRM_DOWNLOAD_ABOVE_BYTES = 10 * 1024 * 1024;
