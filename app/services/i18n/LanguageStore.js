// app/services/i18n/LanguageStore.js
// The person's choice of language (automatic from the phone, or a chosen one), remembered on this phone.
// useLanguage() re-renders a screen when it changes, like useUnits().

import { useEffect, useState } from "react";
import { languageForLocale, setLanguage, getLanguage, LANGUAGES } from "./i18n.js";

const KEY = "@safelink_language";

let AsyncStorage = null;
try {
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
} catch {
  AsyncStorage = null;
}

let preference = "auto"; // "auto" or a language code
let deviceLocale = "en-US";
try {
  deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale || deviceLocale;
} catch {
  // keep the default
}
const listeners = new Set();
let ready = null;

function apply() {
  setLanguage(preference === "auto" ? languageForLocale(deviceLocale) : preference);
  listeners.forEach((cb) => cb());
}

export function init() {
  if (!ready) {
    ready = (async () => {
      try {
        const saved = AsyncStorage ? await AsyncStorage.getItem(KEY) : null;
        if (saved === "auto" || LANGUAGES.some((l) => l.code === saved)) preference = saved;
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
  if (next !== "auto" && !LANGUAGES.some((l) => l.code === next)) return;
  preference = next;
  apply();
  try {
    if (AsyncStorage) await AsyncStorage.setItem(KEY, next);
  } catch {
    // the choice just will not be remembered
  }
}

/** [language, preference]: the language in force, and the setting behind it. */
export function useLanguage() {
  const [, bump] = useState(0);
  useEffect(() => {
    init();
    const cb = () => bump((n) => n + 1);
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return [getLanguage(), preference];
}
