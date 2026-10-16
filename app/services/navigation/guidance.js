// app/services/navigation/guidance.js
// Spoken directions and keeping the screen on during live navigation.
//
// The speaking and the screen lock are done by the phone (native module SafeLinkGuidance, which
// uses the phone's own text-to-speech: no network, no extra permissions). What to say, and when,
// is plain logic here so it can be tested without a phone.

import { NativeModules } from "react-native";

const native = NativeModules.SafeLinkGuidance || null;

/** Keep the screen from locking (true) or let it lock again (false). */
export function keepAwake(on) {
  try {
    if (native) native.keepAwake(!!on);
  } catch {
    // not available: directions still work, the screen may lock
  }
}

/**
 * Keep following you with the screen locked or another app in front (Android: a foreground service with
 * a notification; iOS: background location with the blue indicator). Call stopBackground when done.
 */
export function startBackground() {
  try {
    if (native && native.startBackground) native.startBackground();
  } catch {
    // directions still work with the app in front
  }
}

export function stopBackground() {
  try {
    if (native && native.stopBackground) native.stopBackground();
  } catch {
    // nothing to stop
  }
}

/** Android 13+: ask to show the "following your route" notification. It is fine if the answer is no. */
export async function askNotificationPermission() {
  try {
    const { Platform, PermissionsAndroid } = require("react-native");
    if (Platform.OS === "android" && Platform.Version >= 33) {
      await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS");
    }
  } catch {
    // the service runs either way; only its notification is affected
  }
}

export function speak(text) {
  try {
    if (native && typeof text === "string" && text) native.speak(text);
  } catch {
    // speech is a nicety
  }
}

export function stopSpeaking() {
  try {
    if (native) native.stopSpeaking();
  } catch {
    // nothing to stop
  }
}

/** True if this phone has a voice that can speak directions. */
export async function isSpeechAvailable() {
  try {
    return native ? !!(await native.isSpeechAvailable()) : false;
  } catch {
    return false;
  }
}

// ---- what to say ----

/** "60 meters", "250 meters", "1.5 kilometres": rounded the way a person would say it. */
export function spokenDistance(m) {
  if (!(m >= 0)) return "";
  if (m < 100) return `${Math.max(10, Math.round(m / 10) * 10)} meters`;
  if (m < 1000) return `${Math.round(m / 50) * 50} meters`;
  const km = Math.round(m / 100) / 10;
  return `${km} kilometre${km === 1 ? "" : "s"}`;
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/**
 * Decides what to say as progress comes in. Each instruction is spoken at most twice (once when it
 * is coming up, once when it is close) and the arrival once. The distances depend on how fast you move.
 */
export function createAnnouncer({ mode = "walk" } = {}) {
  const driving = mode === "drive";
  const FAR_M = driving ? 300 : 80;
  const NEAR_M = driving ? 60 : 20;
  let spoken = new Set();

  const once = (key) => {
    if (spoken.has(key)) return false;
    spoken.add(key);
    return true;
  };

  return {
    /** A route (the first, or after re-routing) begins: forget what was said about the old one. */
    reset() {
      spoken = new Set();
    },

    /** The first thing to say for a route. */
    start(route, { rerouted = false } = {}) {
      const first = route && route.steps && route.steps[0];
      if (!first) return null;
      return `${rerouted ? "New route. " : "Starting directions. "}${sentence(first.text)}`;
    },

    offRoute() {
      return "You left the route. Working out a new one.";
    },

    /** Progress from follow.update(); returns text to speak now, or null. */
    update(progress) {
      if (!progress || progress.ignored) return null;
      if (progress.arrived) return once("arrived") ? "You have arrived." : null;
      if (progress.endOfRoad) {
        if (!once("end")) return null;
        const t = progress.toTarget;
        return t
          ? `You have reached the end of the mapped road. They are about ${spokenDistance(t.distanceM)} ${t.direction} of here.`
          : "You have reached the end of the mapped road.";
      }
      const next = progress.next;
      if (!next || next.final) return null;
      if (next.inM <= NEAR_M) return once(`${next.index}:near`) ? (spoken.add(`${next.index}:far`), sentence(next.text)) : null;
      if (next.inM <= FAR_M) {
        return once(`${next.index}:far`) ? `In ${spokenDistance(next.inM)}, ${lowerFirst(sentence(next.text))}` : null;
      }
      return null;
    },
  };
}

// ---- the voice on/off choice, remembered on this phone ----

const VOICE_KEY = "@safelink_voice";
let AsyncStorage = null;
try {
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
} catch {
  AsyncStorage = null;
}

export async function loadVoicePreference() {
  try {
    const v = AsyncStorage ? await AsyncStorage.getItem(VOICE_KEY) : null;
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export async function saveVoicePreference(on) {
  try {
    if (AsyncStorage) await AsyncStorage.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    // the choice just will not be remembered
  }
}
