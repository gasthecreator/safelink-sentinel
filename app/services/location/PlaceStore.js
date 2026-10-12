// app/services/location/PlaceStore.js
// Places the user has named ("School shelter", "Home"), kept on the phone so they can
// be used as a position when GPS has no fix. Stored locally only; never sent unless
// the user attaches one to an alert.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { v4 as uuidv4 } from "uuid";
import { sanitizePlace } from "./places.js";
import { sanitizePosition, sanitizeText, MAX_LABEL } from "./position.js";

const STORAGE_KEY = "@safelink_places";
export const MAX_PLACES = 50;

async function readAll() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    return Array.isArray(saved) ? saved.map(sanitizePlace).filter(Boolean) : [];
  } catch (err) {
    console.log("[SafeLink][Places] Could not read saved places:", err.message);
    return [];
  }
}

async function writeAll(places) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}

/** Newest first. */
export async function listPlaces() {
  return (await readAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Save a place. `position` is { latitude, longitude, accuracyM? }; `kind` is "gps"
 * (measured by the phone) or "manual" (typed in). Throws a readable Error if the name
 * or position is unusable, or the list is full.
 */
export async function addPlace({ name, position, kind = "gps" }) {
  const cleanName = sanitizeText(name, MAX_LABEL);
  if (!cleanName) throw new Error("Give the place a name.");
  const cleanPosition = sanitizePosition(position);
  if (!cleanPosition) throw new Error("That position isn't valid.");
  const places = await readAll();
  if (places.length >= MAX_PLACES) throw new Error(`You can save up to ${MAX_PLACES} places. Delete one first.`);

  const place = sanitizePlace({
    id: uuidv4(),
    name: cleanName,
    latitude: cleanPosition.latitude,
    longitude: cleanPosition.longitude,
    accuracyM: cleanPosition.accuracyM,
    kind,
    createdAt: Date.now(),
  });
  await writeAll([...places, place]);
  return place;
}

export async function removePlace(id) {
  const places = await readAll();
  await writeAll(places.filter((p) => p.id !== id));
}
