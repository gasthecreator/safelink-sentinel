// app/services/units/UnitStore.js
// The person's choice of units (automatic from the phone's region, miles or kilometres), remembered
// on this phone. `useUnits()` re-renders a screen when it changes.

import { useEffect, useState } from "react";
import { unitsForLocale, setCurrentUnits, getCurrentUnits, METRIC, IMPERIAL } from "./units.js";

const KEY = "@safelink_units";

let AsyncStorage = null;
try {
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
} catch {
  AsyncStorage = null;
}

let preference = "auto"; // "auto" | "metric" | "imperial"
let deviceLocale = "en-US";
try {
  deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale || deviceLocale;
} catch {
  // keep the default
}
const listeners = new Set();
let ready = null;

function apply() {
  setCurrentUnits(preference === "auto" ? unitsForLocale(deviceLocale) : preference);
  listeners.forEach((cb) => cb());
}

export function init() {
  if (!ready) {
    ready = (async () => {
      try {
        const saved = AsyncStorage ? await AsyncStorage.getItem(KEY) : null;
        if (saved === "metric" || saved === "imperial" || saved === "auto") preference = saved;
      } catch {
        // use the default
      }
      apply();
    })();
  }
  return ready;
}

export const getPreference = () => preference;

export async function setPreference(next) {
  if (next !== "auto" && next !== "metric" && next !== "imperial") return;
  preference = next;
  apply();
  try {
    if (AsyncStorage) await AsyncStorage.setItem(KEY, next);
  } catch {
    // the choice just will not be remembered
  }
}

/** [units, preference]: the units in force, and the setting behind them. */
export function useUnits() {
  const [, bump] = useState(0);
  useEffect(() => {
    init();
    const cb = () => bump((n) => n + 1);
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return [getCurrentUnits(), preference];
}

export { METRIC, IMPERIAL };
