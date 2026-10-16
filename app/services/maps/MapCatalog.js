// app/services/maps/MapCatalog.js
// Fetch the signed catalog of downloadable map packs and say what each one means for this phone.
// The network is untrusted: the catalog is only believed after verifyCatalog checks its signature.

import { verifyCatalog, CatalogError } from "./catalog.js";
import {
  MAP_CATALOG_URL,
  MAP_CATALOG_PUBLIC_KEY,
  ALLOW_INSECURE_PACK_URLS,
  MAX_CATALOG_BYTES,
} from "../../constants/maps.js";

const TIMEOUT_MS = 15000;

/**
 * Download and verify the catalog. Records the sequence so an older catalog is refused next time.
 * @throws {CatalogError} code: disabled | network | too_large | invalid | stale | ...
 */
export async function fetchCatalog(store, {
  fetchImpl = (...a) => fetch(...a),
  url = MAP_CATALOG_URL,
  publicKey = MAP_CATALOG_PUBLIC_KEY,
  allowInsecure = ALLOW_INSECURE_PACK_URLS,
  now = Date.now(),
} = {}) {
  if (!publicKey) throw new CatalogError("disabled", "Map downloads are not set up in this version of the app.");
  if (!allowInsecure && !/^https:\/\//i.test(url)) throw new CatalogError("invalid", "The map list address is not secure.");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), TIMEOUT_MS);
  let text;
  try {
    const res = await fetchImpl(url, { signal: controller ? controller.signal : undefined, headers: { Accept: "application/json" } });
    if (!res.ok) throw new CatalogError("network", `The map list could not be fetched (${res.status}).`);
    const declared = Number(res.headers && res.headers.get && res.headers.get("content-length"));
    if (declared > MAX_CATALOG_BYTES) throw new CatalogError("too_large", "The map list is too large.");
    text = await res.text();
  } catch (err) {
    if (err instanceof CatalogError) throw err;
    throw new CatalogError("network", "Could not reach the map server. Check the internet connection.");
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_CATALOG_BYTES * 2) throw new CatalogError("too_large", "The map list is too large.");

  let wire;
  try {
    wire = JSON.parse(text);
  } catch {
    throw new CatalogError("invalid", "The map list could not be read.");
  }
  const catalog = verifyCatalog(wire, { publicKey, lastSequence: await store.lastSequence(), allowInsecure, now });
  await store.recordSequence(catalog.sequence);
  return catalog;
}

/** Pair each catalog entry with what is installed: status is "new" | "update" | "installed". */
export function describeCatalog(catalog, installed) {
  const byId = new Map(installed.map((e) => [e.id, e]));
  return catalog.packs.map((entry) => {
    const have = byId.get(entry.id);
    let status = "new";
    if (have) status = entry.version > have.version ? "update" : "installed";
    return { entry, status, installedVersion: have ? have.version : null };
  });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Metres from a position to a map's area: 0 if inside it, otherwise to its nearest edge. */
export function distanceToBboxM(position, bbox) {
  const [south, west, north, east] = bbox;
  const lat = clamp(position.latitude, south, north);
  const lon = clamp(position.longitude, west, east);
  const dLat = (position.latitude - lat) * 111320;
  const dLon = (position.longitude - lon) * 111320 * Math.cos((position.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Put the maps that matter to where you are first: the ones covering your position, then the nearest.
 * Each offer gains `coversYou` and `distanceM` (0 when covered). Without a position the order is kept.
 */
export function rankByPosition(offers, position) {
  if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return offers;
  return offers
    .map((o) => {
      const distanceM = distanceToBboxM(position, o.entry.bbox);
      return { ...o, distanceM, coversYou: distanceM === 0 };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}
