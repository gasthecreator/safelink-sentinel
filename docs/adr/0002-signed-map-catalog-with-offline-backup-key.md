---
status: accepted
date: 2026-10-15
decision-makers: the maintainer
---

# 0002. Sign the map list, with an offline backup key that can retire a leaked key

Recorded afterwards from PRs #13 and #21 and [docs/OFFLINE_MAPS.md](../OFFLINE_MAPS.md).

## Context and Problem Statement
Phones download road maps ("packs") over the internet, then use them with no signal. A wrong or malicious map sends people
the wrong way in an emergency. How does a phone know a downloaded map is the publisher's, when it will rarely have a
second chance to check?

## Decision Drivers
- A tampered map is dangerous, and there is no server or account system to lean on.
- The publisher is one person with no infrastructure budget (maps are hosted as GitHub release files).
- A signing key can leak, and phones that are offline cannot be told at once.

## Considered Options
- Trust HTTPS to the file host alone
- Sign each pack
- Sign one **catalog** (the list of maps with each map's size and SHA-256), and have the app check each download against it

## Decision Outcome
Chosen option: "sign the catalog". The app has the publisher's public key built in, checks the signature before reading
anything in the list, then checks every file's size and hash, and that the file loads as a valid map covering the area the
list promised. A list older than one already seen is refused (no replay). Installs are atomic: nothing is replaced until
every check passes.

A leaked key is handled by a second **backup key**, kept offline. Either key can sign a list; only the backup key can
**retire** a key, and phones remember retirements permanently.

### Consequences
- Good: a compromised file host cannot change what phones accept; interrupted or corrupt downloads leave existing maps alone.
- Bad / trade-offs: the signing key decides what every phone can download, so it must be guarded; a phone learns of a
  retirement only when it next checks for maps; if the backup key also leaks there is no remote recovery (ship a new app).

### Confirmation
`app/__tests__/catalog.test.js` and `packStore.test.js` (forged, replayed, wrong-hash and retired-key cases).
