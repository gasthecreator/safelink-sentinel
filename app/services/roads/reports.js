// app/services/roads/reports.js
// Road reports: someone nearby says a road is blocked, passable, or has a hazard. Pure
// logic for validating them and working out which closures to believe. No storage, no
// network.
//
// Reports come from other people's phones, so they can be wrong or hostile. A false
// "blocked" costs someone a detour; a false "passable" could send them down a road that
// really is blocked. The rules lean toward caution accordingly:
//   - a closure stays in force until it expires, or is cleared by the person who reported
//     it, or by two *different* phones saying it is passable afterwards;
//   - a single "passable" from a stranger does NOT cancel a closure (it is shown as disputed);
//   - everything expires, so a stale report can't block a road for ever.

import { sanitizePosition, sanitizeText } from "../location/position.js";

export const KINDS = ["blocked", "passable", "hazard"];
export const REPORT_WINDOW_MS = 12 * 60 * 60 * 1000; // a report is believed for 12 hours
export const KEEP_MS = 24 * 60 * 60 * 1000; // and remembered for 24
export const MAX_NOTE = 120;
export const CLUSTER_M = 40; // reports this close describe the same spot
export const CLOSURE_RADIUS_M = 40; // roads within this distance of a blocked report are avoided
export const CLEARED_BY_STRANGERS = 2; // distinct phones needed to cancel someone else's closure
export const MAX_TOTAL = 500; // reports kept overall
export const MAX_PER_SENDER = 30; // and from any one phone, so one phone cannot flood the rest out
const MAX_FUTURE_MS = 5 * 60 * 1000;

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function metersBetween(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A clean report, or null. `raw` is { id, kind, position, note, senderId, reportedAt } where
 * everything may be hostile. reportedAt is milliseconds since the epoch.
 */
export function sanitizeReport(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > 64) return null;
  if (typeof raw.senderId !== "string" || !raw.senderId || raw.senderId.length > 64) return null;
  if (!KINDS.includes(raw.kind)) return null;
  const position = sanitizePosition(raw.position, now);
  if (!position) return null;
  const t = raw.reportedAt;
  if (typeof t !== "number" || !Number.isFinite(t) || t > now + MAX_FUTURE_MS || t < now - KEEP_MS) return null;
  return {
    id: raw.id,
    kind: raw.kind,
    latitude: position.latitude,
    longitude: position.longitude,
    accuracyM: position.accuracyM,
    note: sanitizeText(raw.note, MAX_NOTE),
    senderId: raw.senderId,
    reportedAt: Math.round(t),
  };
}

/** A report read back from our own storage (already flat, as sanitizeReport returns it). */
export function sanitizeStoredReport(stored, now = Date.now()) {
  if (!stored || typeof stored !== "object") return null;
  return sanitizeReport(
    {
      id: stored.id,
      kind: stored.kind,
      position: { latitude: stored.latitude, longitude: stored.longitude, accuracyM: stored.accuracyM },
      note: stored.note,
      senderId: stored.senderId,
      reportedAt: stored.reportedAt,
    },
    now
  );
}

/**
 * From a pile of reports, the places that currently matter:
 *   { kind: "blocked"|"hazard", latitude, longitude, radiusM, reportedAt, reporters,
 *     disputed, note }
 * Cleared closures are not returned.
 */
export function effectiveClosures(reports, now = Date.now()) {
  const live = reports
    .filter((r) => now - r.reportedAt < REPORT_WINDOW_MS && r.reportedAt <= now + MAX_FUTURE_MS)
    .sort((a, b) => a.reportedAt - b.reportedAt);

  // group reports about the same spot (greedy, around the first report of each group)
  const clusters = [];
  for (const r of live) {
    const home = clusters.find((c) => metersBetween(c.anchor.latitude, c.anchor.longitude, r.latitude, r.longitude) <= CLUSTER_M);
    if (home) home.reports.push(r);
    else clusters.push({ anchor: r, reports: [r] });
  }

  const out = [];
  for (const { reports: group } of clusters) {
    const blocked = group.filter((r) => r.kind === "blocked");
    const hazards = group.filter((r) => r.kind === "hazard");
    const passable = group.filter((r) => r.kind === "passable");

    if (blocked.length) {
      const latest = blocked[blocked.length - 1];
      const after = passable.filter((r) => r.reportedAt > latest.reportedAt);
      const blockers = new Set(blocked.map((r) => r.senderId));
      const clearedByAuthor = after.some((r) => blockers.has(r.senderId));
      const clearedByStrangers = new Set(after.map((r) => r.senderId)).size >= CLEARED_BY_STRANGERS;
      if (!clearedByAuthor && !clearedByStrangers) {
        out.push({
          kind: "blocked",
          latitude: latest.latitude,
          longitude: latest.longitude,
          radiusM: CLOSURE_RADIUS_M,
          reportedAt: latest.reportedAt,
          reporters: blockers.size,
          disputed: after.length > 0, // someone said passable, but not enough to believe
          note: latest.note,
        });
        continue;
      }
    }
    if (hazards.length) {
      const latest = hazards[hazards.length - 1];
      out.push({
        kind: "hazard",
        latitude: latest.latitude,
        longitude: latest.longitude,
        radiusM: CLOSURE_RADIUS_M,
        reportedAt: latest.reportedAt,
        reporters: new Set(hazards.map((r) => r.senderId)).size,
        disputed: false,
        note: latest.note,
      });
    }
  }
  return out;
}

export function describeKind(kind) {
  return kind === "blocked" ? "Road blocked" : kind === "passable" ? "Road passable" : "Hazard";
}

/** The text that goes in the message body (so a phone without this feature still reads it). */
export function reportText(kind, note) {
  return `${describeKind(kind)}${note ? `: ${note}` : ""}`;
}
