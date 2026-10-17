// app/services/i18n/i18n.js
// Translating the app's words. The English text IS the key: t("Request help") shows "Request help" in English
// and the matching entry of the language's catalog otherwise. A missing translation therefore shows readable
// English instead of a blank or a code, which matters for an emergency app. Pure functions; no native code.
//
//   t("Request help")                          plain text
//   t("{count} devices nearby", { count: 3 })  placeholders
//   tp("{count} device", "{count} devices", n) singular / plural (the catalog gives the plural forms)

import en from "./locales/en.js";
import es from "./locales/es.js";

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
];

const CATALOGS = { en, es };
let current = "en";

/** "es-MX" / "es_419" / "es" -> "es"; anything unknown -> "en". */
export function languageForLocale(locale) {
  const base = typeof locale === "string" ? locale.split(/[-_]/)[0].toLowerCase() : "";
  return LANGUAGES.some((l) => l.code === base) ? base : "en";
}

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  current = LANGUAGES.some((l) => l.code === code) ? code : "en";
}

/** Fill {name} placeholders. A placeholder with no value is left as it is, so the problem is visible. */
function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(params, name) && params[name] != null ? String(params[name]) : whole));
}

function lookup(key, language) {
  const catalog = CATALOGS[language];
  const value = catalog && Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : undefined;
  return value;
}

/** The text for `key` in the current language, with placeholders filled. */
export function t(key, params) {
  const value = lookup(key, current);
  return fill(typeof value === "string" && value.length > 0 ? value : key, params);
}

// plural rules: English and Spanish both use "one" for exactly 1, otherwise "other"
const pluralFor = (count) => (count === 1 ? "one" : "other");

/** Singular or plural by `count` (which is also available to the text as {count}). */
export function tp(one, other, count, params) {
  const value = lookup(one, current);
  let text;
  if (value && typeof value === "object") text = value[pluralFor(count)] || value.other;
  else text = count === 1 ? one : other;
  return fill(text, { count, ...params });
}

/**
 * Marks a phrase that is defined where it cannot be translated yet (a constant at the top of a file) so the
 * translator still sees it; translate it where it is shown: t(item.label).
 */
export const N_ = (text) => text;

/** Every phrase a catalog is expected to have, for the completeness test. */
export function catalogFor(code) {
  return CATALOGS[code];
}
