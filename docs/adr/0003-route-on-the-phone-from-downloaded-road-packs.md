---
status: accepted
date: 2026-10-13
decision-makers: the maintainer
---

# 0003. Route on the phone from downloaded road packs

Recorded afterwards from PR #11 and [docs/OFFLINE_MAPS.md](../OFFLINE_MAPS.md).

## Context and Problem Statement
The app exists for when the internet and cell network are down. Directions to the sender of an alert must therefore work
with no signal. Where does the routing happen, and what map data does it use?

## Considered Options
- Call an online routing service (Google Directions and similar)
- Bundle one fixed map in the app
- Download compact **road packs** (OpenStreetMap roads, names and places, built by `app/scripts/build-routing-pack.js`) and route on the phone

## Decision Outcome
Chosen option: "download road packs and route on the phone". An online service cannot work without signal, which is the
whole situation the app is for; one bundled map would cover a single place and enlarge every install (a small sample map
is bundled so the app can be tried), whereas downloaded packs let each person take their own area. Closed or flooded roads reported over the mesh are routed around. The pack is a
road map only: it knows nothing about closures except what nearby people reported, and the app says so.

### Consequences
- Good: directions, live guidance and "find help nearby" work offline; no per-request cost or key.
- Bad / trade-offs: maps must be downloaded beforehand; pack size limits the area (large areas are built in tiles and
  neighbouring packs are joined); routes are only as good as OpenStreetMap, and the app cannot know about damage.

### Confirmation
`app/__tests__/routing*.test.js`, `tiles.test.js`, `merge-packs.test.js`, including a test on a real built pack.
