// app/services/proximity/RssiTracker.js
// Turns a stream of Bluetooth signal-strength readings (RSSI, in dBm) from one phone
// into something a person can walk by: how close, and whether they are getting closer.
//
// RSSI is a poor ruler. It swings by 10 dB or more from a body in the way, a wall, how
// the phone is held, or just the moment, and phone models differ. So this deliberately
// does NOT claim metres. It reports coarse bands, smoothed with a median, with
// hysteresis so the band doesn't flicker at a boundary, plus a warmer/colder trend,
// which is the part that actually works when you are walking toward someone.

export const BANDS = [
  { id: "here", min: -55, label: "Very close", hint: "Within a few steps" },
  { id: "close", min: -70, label: "Close", hint: "Nearby, look around" },
  { id: "near", min: -85, label: "In range", hint: "Within Bluetooth range, keep moving toward them" },
  { id: "far", min: -Infinity, label: "Weak signal", hint: "At the edge of range" },
];

const VALID_RSSI = [-110, 0];
const HYSTERESIS_DB = 3; // must be this far past a boundary to change band
const TREND_DB = 4; // a change of this much between two windows counts as warmer/colder

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function bandIndexFor(rssi) {
  return BANDS.findIndex((b) => rssi >= b.min);
}

export class RssiTracker {
  constructor({ windowMs = 6000, trendWindowMs = 4000, lostAfterMs = 12000, now = () => Date.now() } = {}) {
    this.windowMs = windowMs;
    this.trendWindowMs = trendWindowMs;
    this.lostAfterMs = lostAfterMs;
    this.now = now;
    this.samples = []; // { t, rssi }
    this.bandIndex = null;
  }

  /** Add a reading. Garbage (not a number, or outside -110..0 dBm) is ignored. */
  add(rssi, t = this.now()) {
    if (typeof rssi !== "number" || !Number.isFinite(rssi) || rssi < VALID_RSSI[0] || rssi > VALID_RSSI[1]) {
      return false;
    }
    this.samples.push({ t, rssi });
    const keepFrom = t - Math.max(this.windowMs, this.trendWindowMs * 2) - 1;
    this.samples = this.samples.filter((s) => s.t >= keepFrom);
    return true;
  }

  within(fromAgo, toAgo, now) {
    return this.samples.filter((s) => now - s.t >= fromAgo && now - s.t < toAgo).map((s) => s.rssi);
  }

  /** What to show right now. */
  summary() {
    const now = this.now();
    const last = this.samples[this.samples.length - 1];
    if (!last) return { state: "searching", band: null, trend: null, smoothed: null, samples: 0, lastSeenMsAgo: null };

    const lastSeenMsAgo = now - last.t;
    if (lastSeenMsAgo > this.lostAfterMs) {
      return { state: "lost", band: null, trend: null, smoothed: null, samples: this.samples.length, lastSeenMsAgo };
    }

    const recent = this.within(0, this.windowMs, now);
    const smoothed = Math.round(median(recent.length ? recent : [last.rssi]));

    // Hysteresis: only move to a different band once clearly past its edge.
    const candidate = bandIndexFor(smoothed);
    if (this.bandIndex === null) {
      this.bandIndex = candidate;
    } else if (candidate !== this.bandIndex) {
      const edge = candidate < this.bandIndex ? BANDS[candidate].min : BANDS[this.bandIndex].min;
      const clear = candidate < this.bandIndex ? smoothed >= edge + HYSTERESIS_DB : smoothed <= edge - HYSTERESIS_DB;
      if (clear) this.bandIndex = candidate;
    }

    // Trend: the last few seconds against the few seconds before that.
    const nowWindow = this.within(0, this.trendWindowMs, now);
    const before = this.within(this.trendWindowMs, this.trendWindowMs * 2, now);
    let trend = null;
    if (nowWindow.length >= 2 && before.length >= 2) {
      const delta = median(nowWindow) - median(before);
      trend = delta >= TREND_DB ? "warmer" : delta <= -TREND_DB ? "colder" : "steady";
    }

    return {
      state: "tracking",
      band: BANDS[this.bandIndex],
      trend,
      smoothed,
      samples: this.samples.length,
      lastSeenMsAgo,
    };
  }

  reset() {
    this.samples = [];
    this.bandIndex = null;
  }
}
