import { loadPack } from "../services/navigation/pack.js";
import { route, distanceM } from "../services/navigation/router.js";
import {
  startFollowing, update, locate, canReroute, markRerouted,
  REROUTE_MIN_INTERVAL_MS, ARRIVE_WITHIN_M,
} from "../services/navigation/follow.js";

const graph = loadPack(require("../assets/maps/grambling-la.json")).graph;
const A = { latitude: 32.5266, longitude: -92.7165 };
const B = { latitude: 32.5405, longitude: -92.6975 };
const r = route(graph, A, B, { mode: "walk" });
const pt = (i) => ({ latitude: r.geometry[i][0], longitude: r.geometry[i][1] });
const shift = (p, northM, eastM) => ({
  latitude: p.latitude + northM / 111320,
  longitude: p.longitude + eastM / (111320 * Math.cos((p.latitude * Math.PI) / 180)),
});

// walk the polyline, one fix every ~stepM
function walk(stepM) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < r.geometry.length - 1; i++) {
    const a = pt(i);
    const b = pt(i + 1);
    const len = distanceM(a.latitude, a.longitude, b.latitude, b.longitude);
    for (let d = carry; d < len; d += stepM) {
      const t = d / len;
      out.push({ latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t, accuracyM: 5 });
    }
    carry = ((carry + Math.ceil((len - carry) / stepM) * stepM) - len);
  }
  out.push({ ...pt(r.geometry.length - 1), accuracyM: 5 });
  return out;
}

test("steps know where along the route they happen", () => {
  expect(r.ok).toBe(true);
  expect(r.steps[0].alongM).toBe(0);
  const alongs = r.steps.map((s) => s.alongM);
  expect([...alongs].sort((a, b) => a - b)).toEqual(alongs);
  expect(alongs[alongs.length - 1]).toBeGreaterThan(r.distanceM - 5);
  expect(alongs[alongs.length - 1]).toBeLessThan(r.distanceM + 5);
});

test("walking the route: progress only goes forward, never off route, arrives at the end", () => {
  let s = startFollowing(r);
  let last = -1;
  let result;
  for (const [i, fix] of walk(10).entries()) {
    result = update(s, fix, B, 1000 + i * 8000);
    s = result.state;
    expect(result.offRoute).toBe(false);
    expect(result.alongM).toBeGreaterThanOrEqual(last);
    expect(result.offM).toBeLessThan(2);
    last = result.alongM;
  }
  // B is off the mapped roads, so the end of the road is not yet "arrived"
  expect(result.arrived).toBe(false);
  expect(result.endOfRoad).toBe(true);
  expect(result.toTarget.distanceM).toBeGreaterThan(ARRIVE_WITHIN_M);
  expect(result.remainingM).toBeLessThanOrEqual(ARRIVE_WITHIN_M);
  expect(result.next.final).toBe(true);
});

test("remaining distance and next instruction update along the way", () => {
  let s = startFollowing(r);
  const first = update(s, walk(10)[0], B, 0);
  expect(first.remainingM).toBeGreaterThan(r.distanceM - 15);
  expect(first.arrived).toBe(false);
  expect(first.next.text).toMatch(/./);
  const fixes = walk(10);
  const mid = fixes[Math.floor(fixes.length / 2)];
  let res;
  for (const [i, f] of fixes.slice(0, Math.floor(fixes.length / 2) + 1).entries()) {
    res = update(s, f, B, i * 8000);
    s = res.state;
  }
  expect(res.remainingM).toBeLessThan(first.remainingM * 0.65);
  expect(res.remainingM).toBeGreaterThan(first.remainingM * 0.35);
  // the next instruction is always ahead of the person, and the countdown is consistent
  expect(res.next.inM).toBeGreaterThanOrEqual(0);
  expect(r.steps[res.next.index].alongM).toBeGreaterThan(res.alongM);
  expect(res.remainingS).toBeLessThan(r.durationS);
  expect(mid).toBeTruthy();
});

test("GPS jitter of 15 m beside the route is not leaving it", () => {
  let s = startFollowing(r);
  const fixes = walk(10);
  fixes.forEach((f, i) => {
    const jittered = shift(f, (i % 2 ? 15 : -15), (i % 3 ? 10 : -10));
    const res = update(s, { ...jittered, accuracyM: 20 }, B, i * 5000);
    s = res.state;
    expect(res.offRoute).toBe(false);
  });
});

test("a single stray fix is ignored; two in a row, seconds apart, mean off route", () => {
  let s = startFollowing(r);
  const fixes = walk(10);
  s = update(s, fixes[3], B, 0).state;
  const away = { ...shift(fixes[4], 3000, 3000), accuracyM: 8 };
  let res = update(s, away, B, 10000);
  expect(res.offRoute).toBe(false);          // first off fix: wait
  res = update(res.state, { ...shift(fixes[4], 3000, 3000), accuracyM: 8 }, B, 10500);
  expect(res.offRoute).toBe(false);          // second, but under 4 s later: still wait
  res = update(res.state, { ...shift(fixes[4], 3000, 3000), accuracyM: 8 }, B, 15000);
  expect(res.offRoute).toBe(true);
  // coming back on the route clears it
  res = update(res.state, fixes[5], B, 20000);
  expect(res.offRoute).toBe(false);
  expect(res.state.offFixes).toBe(0);
});

test("fixes with poor accuracy change nothing", () => {
  let s = startFollowing(r);
  s = update(s, walk(10)[5], B, 0).state;
  const before = s.alongM;
  const res = update(s, { ...shift(walk(10)[5], 900, 900), accuracyM: 500 }, B, 1000);
  expect(res.ignored).toBe(true);
  expect(res.state.alongM).toBe(before);
  expect(res.state.offFixes).toBe(0);
  expect(res.offRoute).toBe(false);
});

test("a route that crosses itself does not teleport you ahead", () => {
  // a figure of eight: out, loop round, back through the crossing, away
  const mk = (pts) => ({ geometry: pts, durationS: 100, steps: [], distanceM: 0 });
  const pts = [[0, 0], [0, 0.002], [0.002, 0.002], [0.002, 0.001], [-0.001, 0.001], [-0.001, 0.003]];
  const prep = startFollowing(mk(pts)).prep;
  // crossing point is (0, 0.001): reached early on, and again later
  const early = locate(prep, { latitude: 0, longitude: 0.001 }, 0);
  const late = locate(prep, { latitude: 0, longitude: 0.001 }, prep.total * 0.75);
  expect(late.alongM).toBeGreaterThan(early.alongM + 100);
});

test("rerouting is rate limited", () => {
  let s = startFollowing(r);
  expect(canReroute(s, 0)).toBe(true);
  s = markRerouted(s, 1000);
  expect(canReroute(s, 1000 + REROUTE_MIN_INTERVAL_MS - 1)).toBe(false);
  expect(canReroute(s, 1000 + REROUTE_MIN_INTERVAL_MS)).toBe(true);
});

test("arriving counts when they are near the target even if the road ends short", () => {
  let s = startFollowing(r);
  const res = update(s, { ...shift(B, 10, 0), accuracyM: 5 }, B, 0);
  expect(res.arrived).toBe(true);
});

test("small GPS wobble backwards does not move you back; really turning back does", () => {
  // a straight road about 1.1 km long, so what "behind" means is unambiguous
  const line = { geometry: [[0, 0], [0, 0.005], [0, 0.01]], durationS: 800, distanceM: 1113, steps: [] };
  const at = (m) => ({ latitude: 0, longitude: m / 111320, accuracyM: 5 });
  let s = startFollowing(line);
  let res = update(s, at(500), null, 0);
  expect(Math.round(res.alongM)).toBe(500);
  res = update(res.state, at(470), null, 8000); // 30 m behind: noise
  expect(Math.round(res.alongM)).toBe(500);
  res = update(res.state, at(300), null, 16000); // 200 m behind: they turned round
  expect(Math.round(res.alongM)).toBe(300);
});

test("far from the end of the road you are not at its end, whatever the projection says", () => {
  const s = startFollowing(r);
  const far = update(s, { ...shift(pt(r.geometry.length - 1), 400, 0), accuracyM: 5 }, B, 0);
  expect(far.endOfRoad).toBe(false);
  expect(far.arrived).toBe(false);
});
