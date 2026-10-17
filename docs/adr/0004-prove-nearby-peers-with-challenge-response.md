---
status: accepted
date: 2026-10-17
decision-makers: the maintainer
---

# 0004. Prove nearby phones with a signed challenge

Recorded afterwards from PR #31 and [docs/SECURITY.md](../SECURITY.md) (limit 3).

## Context and Problem Statement
Every message is signed, so its author cannot be faked. But a nearby phone's *profile* (name, keys) is public, so another
device could copy Bob's profile, appear at a new Bluetooth address, and receive messages meant for Bob.

## Considered Options
- Do nothing: treat the profile as the identity
- Pair phones by hand (QR code or PIN)
- Challenge-response: on meeting, send a random challenge; the other phone signs it with its identity key; trust it for a short time

## Decision Outcome
Chosen option: "challenge-response" (`PeerProof`): a phone that passes is "verified" for 10 minutes; direct messages are
never handed to a device that has not proved who it is; alerts and relays still reach unverified phones. Manual pairing is
unusable in an emergency.

### Consequences
- Good: copying a profile no longer takes over a neighbour's entry or their direct messages.
- Bad / trade-offs: an attacker between two phones can relay the challenge to the real phone in real time; older builds
  cannot answer and show as "not verified"; **the timing of the exchange on real Bluetooth hardware is untested**: it is
  verified only against a simulated link, and the two-phone test must confirm it.

### Confirmation
`app/__tests__/peer-proof.test.js` and `peer-takeover.test.js`. Revisit after the real two-phone test.
