jest.mock("react-native", () => ({ NativeModules: {} }));
import { createAnnouncer, spokenDistance } from "../services/navigation/guidance.js";

const prog = (over) => ({ ignored: false, arrived: false, endOfRoad: false, next: { text: "Turn left onto Main Street", inM: 500, index: 1, final: false }, ...over });
const at = (inM, index = 1, text = "Turn left onto Main Street") => prog({ next: { text, inM, index, final: false } });

describe("spokenDistance", () => {
  test.each([
    [4, "10 meters"], [47, "50 meters"], [95, "100 meters"], [120, "100 meters"], [180, "200 meters"],
    [640, "650 meters"], [999, "1000 meters"], [1000, "1 kilometre"], [1500, "1.5 kilometres"], [12340, "12.3 kilometres"],
  ])("%d m", (m, words) => expect(spokenDistance(m)).toBe(words));
  test("nonsense is silent", () => expect(spokenDistance(NaN)).toBe(""));
});

describe("announcements on foot", () => {
  test("a turn is announced when it is coming up, then once more when it is close, never repeatedly", () => {
    const a = createAnnouncer({ mode: "walk" });
    expect(a.update(at(300))).toBeNull();
    expect(a.update(at(79))).toBe("In 80 meters, turn left onto Main Street.");
    expect(a.update(at(60))).toBeNull();
    expect(a.update(at(40))).toBeNull();
    expect(a.update(at(18))).toBe("Turn left onto Main Street.");
    expect(a.update(at(5))).toBeNull();
  });
  test("the next turn is announced afresh", () => {
    const a = createAnnouncer();
    a.update(at(70, 1)); a.update(at(10, 1));
    expect(a.update(at(70, 2, "Turn right onto Oak Avenue"))).toBe("In 70 meters, turn right onto Oak Avenue.");
  });
  test("arriving at a turn all at once (a jump) says only the close instruction, not both", () => {
    const a = createAnnouncer();
    expect(a.update(at(10))).toBe("Turn left onto Main Street.");
    expect(a.update(at(60))).toBeNull();
  });
  test("driving announces earlier", () => {
    const a = createAnnouncer({ mode: "drive" });
    expect(a.update(at(280))).toBe("In 300 meters, turn left onto Main Street.");
    expect(a.update(at(50))).toBe("Turn left onto Main Street.");
  });
});

describe("start, off route, arrival", () => {
  test("start reads the first step; a new route says so", () => {
    const a = createAnnouncer();
    const route = { steps: [{ text: "Head south on Coleman Street" }] };
    expect(a.start(route)).toBe("Starting directions. Head south on Coleman Street.");
    expect(a.start(route, { rerouted: true })).toBe("New route. Head south on Coleman Street.");
    expect(a.start({ steps: [] })).toBeNull();
  });
  test("leaving the route is announced", () => {
    expect(createAnnouncer().offRoute()).toMatch(/left the route/);
  });
  test("arrival and end of road are each said once", () => {
    const a = createAnnouncer();
    expect(a.update(prog({ arrived: true }))).toBe("You have arrived.");
    expect(a.update(prog({ arrived: true }))).toBeNull();
    const b = createAnnouncer();
    const end = prog({ endOfRoad: true, toTarget: { distanceM: 288, direction: "north-east" } });
    expect(b.update(end)).toBe("You have reached the end of the mapped road. They are about 300 meters north-east of here.");
    expect(b.update(end)).toBeNull();
  });
  test("poor-GPS (ignored) fixes and the final step say nothing", () => {
    const a = createAnnouncer();
    expect(a.update(prog({ ignored: true }))).toBeNull();
    expect(a.update(prog({ next: { text: "You have arrived", inM: 10, index: 5, final: true } }))).toBeNull();
    expect(a.update(null)).toBeNull();
  });
  test("reset forgets what was said, so a new route is announced from scratch", () => {
    const a = createAnnouncer();
    a.update(at(70)); a.reset();
    expect(a.update(at(70))).toBe("In 70 meters, turn left onto Main Street.");
  });
});

describe("the native module is optional", () => {
  test("without it nothing throws and speech is reported unavailable", async () => {
    const g = require("../services/navigation/guidance.js");
    expect(() => { g.keepAwake(true); g.speak("hi"); g.stopSpeaking(); g.startBackground(); g.stopBackground(); }).not.toThrow();
    await expect(g.askNotificationPermission()).resolves.toBeUndefined();
    expect(await g.isSpeechAvailable()).toBe(false);
  });
  test("with it, calls reach the phone (and a throwing phone does not break directions)", async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock("react-native", () => ({
      NativeModules: { SafeLinkGuidance: { keepAwake: (v) => calls.push(["keepAwake", v]), speak: (t, lang) => calls.push(["speak", t, lang]), stopSpeaking: () => calls.push(["stop"]), startBackground: (...texts) => calls.push(["bg", "start", ...texts]), stopBackground: () => calls.push(["bg", "stop"]), isSpeechAvailable: async (lang) => { calls.push(["avail", lang]); return true; } } },
    }));
    const g = require("../services/navigation/guidance.js");
    g.keepAwake(true); g.speak("Turn left."); g.speak(""); g.stopSpeaking(); g.startBackground(); g.stopBackground();
    expect(calls).toEqual([
      ["keepAwake", true], ["speak", "Turn left.", "en"], ["stop"],
      ["bg", "start", "SafeLink directions", "Following your route. Tap to open.", "Live directions", "Shown while SafeLink is following your route"],
      ["bg", "stop"],
    ]);
    expect(await g.isSpeechAvailable()).toBe(true);
    expect(calls[calls.length - 1]).toEqual(["avail", "en"]);

    // the phone is told the APP's language (speech and the notification), whatever the phone's own language is
    const { setLanguage } = require("../services/i18n/i18n.js");
    setLanguage("es");
    calls.length = 0;
    g.speak("Gira a la izquierda."); g.startBackground(); await g.isSpeechAvailable();
    expect(calls).toEqual([
      ["speak", "Gira a la izquierda.", "es"],
      ["bg", "start", "Indicaciones de SafeLink", "Siguiendo tu ruta. Toca para abrir.", "Indicaciones en vivo", "Se muestra mientras SafeLink sigue tu ruta"],
      ["avail", "es"],
    ]);
    setLanguage("en");
    jest.resetModules();
    jest.doMock("react-native", () => ({ NativeModules: { SafeLinkGuidance: { speak() { throw new Error("boom"); }, keepAwake() { throw new Error("boom"); } } } }));
    const bad = require("../services/navigation/guidance.js");
    expect(() => { bad.speak("x"); bad.keepAwake(true); bad.startBackground(); bad.stopBackground(); }).not.toThrow(); // also an older module without the background methods
  });
});
