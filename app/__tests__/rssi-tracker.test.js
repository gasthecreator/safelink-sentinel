import { RssiTracker, BANDS } from "../services/proximity/RssiTracker.js";

// A tracker driven by a fake clock, fed one reading per `step` ms.
function rig(opts = {}) {
  let t = 1_000_000;
  const tracker = new RssiTracker({ now: () => t, ...opts });
  return {
    tracker,
    at: () => t,
    advance: (ms) => { t += ms; },
    feed(values, step = 500) {
      for (const v of values) { tracker.add(v, t); t += step; }
    },
  };
}

describe("readings", () => {
  test("garbage is ignored", () => {
    const { tracker } = rig();
    for (const bad of [undefined, null, "-60", NaN, Infinity, -200, 5, {}, []]) {
      expect(tracker.add(bad)).toBe(false);
    }
    expect(tracker.summary().state).toBe("searching");
  });

  test("nothing heard yet is 'searching', not an error", () => {
    expect(rig().tracker.summary()).toMatchObject({ state: "searching", band: null, trend: null });
  });
});

describe("bands", () => {
  const bandFor = (rssi) => {
    const r = rig();
    r.feed([rssi, rssi, rssi]);
    return r.tracker.summary().band.id;
  };
  test("stronger signal means closer", () => {
    expect(bandFor(-40)).toBe("here");
    expect(bandFor(-62)).toBe("close");
    expect(bandFor(-78)).toBe("near");
    expect(bandFor(-95)).toBe("far");
  });
  test("the labels never claim metres", () => {
    for (const b of BANDS) expect(`${b.label} ${b.hint}`).not.toMatch(/\d+\s*(m|metres|meters|ft)\b/i);
  });
  test("a single wild reading doesn't move the band (median, not mean)", () => {
    const r = rig();
    r.feed([-50, -51, -49, -50, -95, -50, -51, -50]);
    expect(r.tracker.summary().band.id).toBe("here");
  });
  test("hysteresis: hovering at a boundary doesn't flicker", () => {
    const r = rig({ windowMs: 1500 });
    r.feed([-60, -60, -60]); // settles in 'close' (boundary with 'near' is -70)
    const seen = new Set();
    for (const v of [-69, -71, -69, -72, -68, -71, -70, -69]) {
      r.feed([v, v], 400);
      seen.add(r.tracker.summary().band.id);
    }
    expect([...seen]).toEqual(["close"]); // never bounced to 'near'
  });
  test("but a real move of several dB does change the band", () => {
    const r = rig({ windowMs: 1500 });
    r.feed([-60, -60, -60]);
    r.feed([-80, -80, -80, -80, -80], 400);
    expect(r.tracker.summary().band.id).toBe("near");
    r.feed([-50, -50, -50, -50, -50], 400);
    expect(r.tracker.summary().band.id).toBe("here");
  });
});

describe("warmer / colder", () => {
  test("walking toward them", () => {
    const r = rig();
    r.feed([-85, -84, -85, -84, -83, -84, -83, -84]); // earlier window
    r.feed([-70, -69, -68, -67, -66, -66, -65, -64]); // recent window
    expect(r.tracker.summary().trend).toBe("warmer");
  });
  test("walking away", () => {
    const r = rig();
    r.feed([-60, -61, -60, -61, -60, -61, -60, -61]);
    r.feed([-78, -79, -80, -79, -80, -81, -80, -81]);
    expect(r.tracker.summary().trend).toBe("colder");
  });
  test("small wobbles are 'steady'", () => {
    const r = rig();
    r.feed([-70, -72, -69, -71, -70, -72, -69, -71, -70, -71, -69, -72, -70, -71, -70, -71]);
    expect(r.tracker.summary().trend).toBe("steady");
  });
  test("with too little history there is no trend, rather than a guess", () => {
    const r = rig();
    r.feed([-70, -60]);
    expect(r.tracker.summary().trend).toBeNull();
  });
});

describe("losing and regaining the signal", () => {
  test("goes quiet -> 'lost', and recovers when heard again", () => {
    const r = rig();
    r.feed([-60, -60, -60]);
    expect(r.tracker.summary().state).toBe("tracking");
    r.advance(13000);
    expect(r.tracker.summary()).toMatchObject({ state: "lost", band: null, trend: null });
    r.feed([-62, -61]);
    expect(r.tracker.summary().state).toBe("tracking");
  });
  test("old readings don't pile up", () => {
    const r = rig();
    r.feed(new Array(500).fill(-60), 100);
    expect(r.tracker.samples.length).toBeLessThan(150);
  });
  test("reset forgets everything", () => {
    const r = rig();
    r.feed([-60, -60, -60]);
    r.tracker.reset();
    expect(r.tracker.summary().state).toBe("searching");
  });
});
