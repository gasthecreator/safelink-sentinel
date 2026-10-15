// app/services/navigation/follow.js
// Following a route as the person moves: where along it they are, how far they are from it,
// what the next instruction is, whether they have left it, and whether they have arrived.
// Plain functions over a route from router.js and a GPS fix; no timers, no React.
//
// GPS jitters, so one stray fix never counts as "off the route": it takes two off-route fixes
// at least a few seconds apart, and a fix with a poor accuracy is ignored altogether.

import { distanceM, bearingDeg, compassName } from "./router.js";

export const IGNORE_ACCURACY_ABOVE_M = 100;
export const OFF_ROUTE_MIN_M = 40;
export const OFF_ROUTE_MAX_M = 120;
export const OFF_ROUTE_CONFIRM_FIXES = 2;
export const OFF_ROUTE_CONFIRM_MS = 4000;
export const ARRIVE_WITHIN_M = 25;        // close enough to them to say you have arrived
export const END_OF_ROAD_WITHIN_M = 60;   // close enough to where the mapped road ends
export const REROUTE_MIN_INTERVAL_MS = 15000;
const BACKTRACK_M = 60; // GPS noise may put you a little behind where you were
const LOOKAHEAD_M = 500;

const M_PER_DEG_LAT = 111320;

/** Prepares the route's polyline once: cumulative distance at each vertex. */
export function prepareRoute(route) {
  const g = route.geometry || [];
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + distanceM(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
  return { route, g, cum, total: cum[cum.length - 1] || 0 };
}

// Closest point on segment i (g[i] -> g[i+1]) to p: { offM, alongM }
function onSegment(prep, i, p) {
  const [la, lo] = prep.g[i];
  const [lb, lob] = prep.g[i + 1];
  const k = Math.cos((la * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (lob - lo) * k * M_PER_DEG_LAT;
  const by = (lb - la) * M_PER_DEG_LAT;
  const px = (p.longitude - lo) * k * M_PER_DEG_LAT;
  const py = (p.latitude - la) * M_PER_DEG_LAT;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
  const cx = ax + t * (bx - ax);
  const cy = ay + t * (by - ay);
  return { offM: Math.hypot(px - cx, py - cy), alongM: prep.cum[i] + t * Math.sqrt(len2) };
}

/** Where on the route a position is, preferring places near where the person already was. */
export function locate(prep, p, previousAlongM = 0) {
  let best = null;
  let bestAny = null;
  for (let i = 0; i < prep.g.length - 1; i++) {
    const r = onSegment(prep, i, p);
    if (!bestAny || r.offM < bestAny.offM) bestAny = r;
    const inWindow = r.alongM >= previousAlongM - BACKTRACK_M && r.alongM <= previousAlongM + LOOKAHEAD_M;
    if (inWindow && (!best || r.offM < best.offM)) best = r;
  }
  // the window keeps a route that doubles back on itself from jumping the person ahead;
  // but if nothing in it is close, trust the overall closest point
  if (best && (best.offM <= OFF_ROUTE_MAX_M || !bestAny)) return best;
  return bestAny || { offM: Infinity, alongM: previousAlongM };
}

export function startFollowing(route) {
  return { prep: prepareRoute(route), alongM: 0, offFixes: 0, firstOffAt: null, lastRerouteAt: -Infinity };
}

/**
 * Feed one GPS fix.
 * @param state     from startFollowing / a previous call (not mutated)
 * @param fix       a position { latitude, longitude, accuracyM? }
 * @param target    where they are, for arrival ({latitude, longitude})
 * @returns {{state, ignored, alongM, offM, remainingM, remainingS, next, arrived, offRoute}}
 *   next: { text, inM, index } the next instruction ahead of the person
 */
export function update(state, fix, target, now = Date.now()) {
  const { prep } = state;
  const accuracy = Number.isFinite(fix.accuracyM) ? fix.accuracyM : 0;
  if (accuracy > IGNORE_ACCURACY_ABOVE_M) {
    return { ...summarise(state, state.alongM, null, target), state, ignored: true };
  }

  const loc = locate(prep, fix, state.alongM);
  // never move backwards by more than noise: progress along the route only ratchets forward,
  // except by a clear amount (they really did turn back)
  const alongM = loc.alongM >= state.alongM - BACKTRACK_M ? Math.max(state.alongM, loc.alongM) : loc.alongM;

  const threshold = Math.max(OFF_ROUTE_MIN_M, Math.min(OFF_ROUTE_MAX_M, 25 + 1.5 * accuracy));
  const off = loc.offM > threshold;
  let { offFixes, firstOffAt } = state;
  if (off) {
    offFixes += 1;
    if (firstOffAt === null) firstOffAt = now;
  } else {
    offFixes = 0;
    firstOffAt = null;
  }
  const next = { ...state, alongM, offFixes, firstOffAt };
  const offRoute = offFixes >= OFF_ROUTE_CONFIRM_FIXES && now - firstOffAt >= OFF_ROUTE_CONFIRM_MS;
  return { ...summarise(next, alongM, loc.offM, target, fix), state: next, ignored: false, offRoute };
}

function summarise(state, alongM, offM, target, fix) {
  const { prep } = state;
  const remainingM = Math.max(0, prep.total - alongM);
  const route = prep.route;
  const remainingS = prep.total > 0 ? Math.round((route.durationS || 0) * (remainingM / prep.total)) : 0;
  const steps = route.steps || [];
  let index = steps.findIndex((s) => s.alongM > alongM + 5);
  if (index < 0) index = steps.length - 1;
  const step = steps[index];
  const close = fix && target ? distanceM(fix.latitude, fix.longitude, target.latitude, target.longitude) : Infinity;
  const end = route.geometry && route.geometry.length ? route.geometry[route.geometry.length - 1] : null;
  const toEnd = fix && end ? distanceM(fix.latitude, fix.longitude, end[0], end[1]) : Infinity;
  // "arrived" means near THEM. Their position may be off the mapped roads, so reaching the end of
  // the road is reported separately, with which way and how far they are from there.
  const arrived = close <= ARRIVE_WITHIN_M;
  const endOfRoad = !arrived && remainingM <= ARRIVE_WITHIN_M && toEnd <= END_OF_ROAD_WITHIN_M;
  return {
    alongM,
    offM,
    remainingM: Math.round(remainingM),
    remainingS,
    next: step ? { text: step.text, inM: Math.max(0, Math.round(step.alongM - alongM)), index, final: index === steps.length - 1 } : null,
    arrived,
    endOfRoad,
    toTarget: Number.isFinite(close) && target
      ? { distanceM: Math.round(close), direction: compassName(bearingDeg(fix.latitude, fix.longitude, target.latitude, target.longitude)) }
      : null,
    offRoute: false,
  };
}

/** May a new route be worked out now? (Rate limit so a bad GPS patch cannot loop.) */
export function canReroute(state, now = Date.now()) {
  return now - state.lastRerouteAt >= REROUTE_MIN_INTERVAL_MS;
}

export function markRerouted(state, now = Date.now()) {
  return { ...state, lastRerouteAt: now };
}
