import { t, tp, N_, setLanguage, getLanguage, languageForLocale, LANGUAGES, catalogFor } from "../services/i18n/i18n.js";
import { loadPack } from "../services/navigation/pack.js";
import { route } from "../services/navigation/router.js";
import { createAnnouncer } from "../services/navigation/guidance.js";
import { setCurrentUnits, formatDistance, spokenDistance } from "../services/units/units.js";
import { describePosition, describeLocationOutcome } from "../services/location/position.js";
import { describeKind } from "../services/roads/reports.js";
import { formatDuration } from "../services/navigation/mapView.js";

jest.mock("react-native", () => ({ NativeModules: {} }));

const { allPhrases, unwrapped } = require("../scripts/lib/i18nScan.js");
const root = require("path").join(__dirname, "..");

afterEach(() => {
  setLanguage("en");
  setCurrentUnits("metric");
});

describe("the translation functions", () => {
  test("English is the key: a phrase comes back as itself, placeholders filled", () => {
    expect(t("Request help")).toBe("Request help");
    expect(t("{minutes} min ago", { minutes: 5 })).toBe("5 min ago");
    expect(t("{a} and {b}", { a: "x" })).toBe("x and {b}"); // a missing value stays visible
    expect(t("{a}", { a: "$& $1 {a}" })).toBe("$& $1 {a}"); // values are inserted as text, never interpreted
    expect(t("{a}", { a: 0 })).toBe("0");
    expect(t("{a}", { a: null })).toBe("{a}");
  });
  test("plurals follow the count", () => {
    expect(tp("{count} device", "{count} devices", 1)).toBe("1 device");
    expect(tp("{count} device", "{count} devices", 0)).toBe("0 devices");
    expect(tp("{count} device", "{count} devices", 2)).toBe("2 devices");
    setLanguage("es");
    expect(tp("{count} device", "{count} devices", 1)).toBe("1 dispositivo");
    expect(tp("{count} device", "{count} devices", 3)).toBe("3 dispositivos");
  });
  test("a phrase with no translation shows in English, never blank or as a code", () => {
    setLanguage("es");
    expect(t("A sentence nobody has translated yet")).toBe("A sentence nobody has translated yet");
    expect(t("")).toBe("");
  });
  test("an object key like 'constructor' or '__proto__' is just a phrase", () => {
    setLanguage("es");
    expect(t("constructor")).toBe("constructor");
    expect(t("__proto__")).toBe("__proto__");
    expect(t("toString")).toBe("toString");
  });
  test("N_ marks a phrase without changing it", () => {
    expect(N_("critical")).toBe("critical");
  });
  test("which language a phone gets", () => {
    for (const [locale, code] of [["es-MX", "es"], ["es_419", "es"], ["es", "es"], ["ES-us", "es"], ["en-US", "en"], ["fr-FR", "en"], ["", "en"], [undefined, "en"], [42, "en"]]) {
      expect(languageForLocale(locale)).toBe(code);
    }
    setLanguage("klingon");
    expect(getLanguage()).toBe("en");
  });
});

describe("the Spanish catalog is complete and consistent", () => {
  const es = catalogFor("es");
  const phrases = allPhrases(root);
  const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");

  test("every phrase the code asks for is translated", () => {
    const missing = [...phrases.keys()].filter((k) => !(k in es));
    expect(missing).toEqual([]);
  });
  test("nothing in the catalog is left over from deleted code", () => {
    const unused = Object.keys(es).filter((k) => !phrases.has(k));
    expect(unused).toEqual([]);
  });
  test("every translation keeps exactly the placeholders of its English", () => {
    const bad = [];
    for (const [key, info] of phrases) {
      const v = es[key];
      if (info.plural) {
        if (!v || typeof v !== "object" || !v.one || !v.other) bad.push(`${key}: needs one and other`);
        else if (holes(v.one) !== holes(key) || holes(v.other) !== holes(info.plural)) bad.push(`${key}: placeholders`);
      } else if (typeof v !== "string" || !v.trim()) bad.push(`${key}: empty or not text`);
      else if (holes(v) !== holes(key)) bad.push(`${key}: placeholders`);
    }
    expect(bad).toEqual([]);
  });
  test("no translation is just the English copied back (apart from names and abbreviations)", () => {
    const same = Object.entries(es).filter(([k, v]) => v === k).map(([k]) => k);
    expect(same.sort()).toEqual(["GPS", "SafeLink Mesh", "normal", "ID: {id}...", "Error", "Hospital", "no"].sort());
  });
  test("every language offered has a catalog", () => {
    for (const l of LANGUAGES) expect(catalogFor(l.code)).toBeTruthy();
  });
});

describe("no visible English left in the screens", () => {
  test("every piece of screen text goes through t()", () => {
    const left = unwrapped(root).map((p) => `${require("path").basename(p.file)}:${p.line} ${p.text.slice(0, 50)}`);
    expect(left).toEqual([]);
  });
});

describe("real output, in Spanish", () => {
  const graph = loadPack(require("../assets/maps/grambling-la.json")).graph;
  const A = { latitude: 32.5266, longitude: -92.7165 };
  const B = { latitude: 32.5405, longitude: -92.6975 };

  test("the same route reads in either language, with the same shape", () => {
    const en = route(graph, A, B, { mode: "walk" });
    setLanguage("es");
    const es = route(graph, A, B, { mode: "walk" });
    expect(es.steps).toHaveLength(en.steps.length);
    expect(es.distanceM).toBe(en.distanceM);
    expect(es.steps[0].text).toBe("Dirígete hacia el sur por Coleman Street");
    expect(es.steps[1].text).toBe("Gira a la izquierda hacia College Avenue");
    expect(es.steps[es.steps.length - 1].text).toBe("Has llegado");
    expect(es.steps[3].text).toMatch(/^Gira a la izquierda hacia Main Street$/);
    for (const s of es.steps) expect(s.text).not.toMatch(/\b(Turn|Head|Continue|arrived|onto)\b/); // no English left in a step
  });
  test("road names from the map are left exactly as they are", () => {
    setLanguage("es");
    const r = route(graph, A, B, { mode: "walk" });
    expect(r.steps.map((s) => s.text).join(" ")).toMatch(/Martin Luther King Junior Avenue/);
  });
  test("warnings and failures are Spanish too", () => {
    setLanguage("es");
    const far = route(graph, A, { latitude: 10, longitude: 10 }, { mode: "walk" });
    expect(far.ok).toBe(false);
    expect(far.message).toBe("Su ubicación está fuera del mapa «Grambling, LA (sample)».");
    const shelter = route(graph, A, B, { mode: "walk" });
    expect(shelter.warnings.join(" ")).toMatch(/La calle conocida más cercana a ellos está a/);
  });
  test("the voice speaks Spanish, in feet or metres", () => {
    setLanguage("es");
    const next = (inM) => ({ ignored: false, arrived: false, endOfRoad: false, next: { text: "Gira a la izquierda hacia Main Street", inM, index: 1, final: false } });
    expect(createAnnouncer({ mode: "walk", units: "metric" }).update(next(60))).toBe("En 60 metros, gira a la izquierda hacia Main Street.");
    expect(createAnnouncer({ mode: "walk", units: "imperial" }).update(next(60))).toBe("En 200 pies, gira a la izquierda hacia Main Street.");
    const a = createAnnouncer({ mode: "walk" });
    expect(a.offRoute()).toBe("Saliste de la ruta. Calculando una nueva.");
    expect(a.update({ ignored: false, arrived: true })).toBe("Has llegado.");
    expect(a.start({ steps: [{ text: "Gira a la izquierda" }] })).toBe("Iniciando las indicaciones. Gira a la izquierda.");
    expect(spokenDistance(1609.344, "imperial")).toBe("1 milla");
    expect(spokenDistance(3218, "imperial")).toBe("2 millas");
    expect(spokenDistance(1500, "metric")).toBe("1.5 kilómetros");
  });
  test("positions, times, outcomes and kinds", () => {
    setLanguage("es");
    const now = 1_700_000_000_000;
    const d = describePosition({ latitude: 32.5, longitude: -92.7, accuracyM: 5, fixedAt: now - 5 * 60000, source: "gps" }, now);
    expect(d.text).toBe("32.50000, -92.70000 (±5 m, ubicación hace 5 min)");
    expect(describePosition({ latitude: 32.5, longitude: -92.7, source: "place", label: "Escuela" }, now).provenance).toBe("Del lugar guardado «Escuela»");
    expect(describeLocationOutcome({ reason: "denied" })).toBe("Se envió sin tu ubicación: se rechazó el permiso de ubicación.");
    expect(describeKind("blocked")).toBe("Calle bloqueada");
    expect(describeKind("hazard")).toBe("Peligro");
    expect(formatDuration(10)).toBe("menos de un minuto");
    expect(formatDuration(5 * 60)).toBe("5 min");
  });
  test("switching back restores English everywhere", () => {
    setLanguage("es");
    setLanguage("en");
    expect(route(graph, A, B, { mode: "walk" }).steps[0].text).toBe("Head south on Coleman Street");
  });
});

describe("the choice of language is remembered", () => {
  function fresh(store) {
    let mod;
    jest.isolateModules(() => {
      jest.doMock("@react-native-async-storage/async-storage", () => ({
        __esModule: true,
        default: {
          getItem: async (k) => store[k] ?? null,
          setItem: async (k, v) => { store[k] = v; },
          removeItem: async (k) => { delete store[k]; },
        },
      }));
      mod = { store: require("../services/i18n/LanguageStore.js"), i18n: require("../services/i18n/i18n.js") };
    });
    return mod;
  }
  test("a chosen language is saved, applied, and restored after a restart", async () => {
    const data = {};
    const first = fresh(data);
    await first.store.init();
    await first.store.setPreference("es");
    expect(first.i18n.getLanguage()).toBe("es");
    expect(data["@safelink_language"]).toBe("es");
    const second = fresh(data); // the app is reopened
    await second.store.init();
    expect(second.i18n.getLanguage()).toBe("es");
    await second.store.setPreference("auto");
    expect(data["@safelink_language"]).toBe("auto");
  });
  test("junk in storage or in a request is ignored", async () => {
    const data = { "@safelink_language": "klingon" };
    const m = fresh(data);
    await m.store.init();
    expect(m.store.getPreference()).toBe("auto");
    await m.store.setPreference("klingon");
    expect(m.store.getPreference()).toBe("auto");
    expect(data["@safelink_language"]).toBe("klingon"); // untouched: a refused choice writes nothing
  });
});
