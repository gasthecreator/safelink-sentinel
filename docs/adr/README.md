# Architecture decision records

Short notes on **why** the code is shaped the way it is. One file per decision, numbered, in the
[MADR](https://adr.github.io/madr/) format. An accepted ADR is never edited to change its decision: write a new one that
supersedes it.

Write one when a choice is hard to reverse, affects security or the wire format, or someone later would reasonably ask
"why on earth is it like this?". ADRs 0002 to 0005 were written afterwards from the pull requests and docs that made the
decisions; later ones should be written with the change.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](0002-signed-map-catalog-with-offline-backup-key.md) | Sign the map list, with an offline backup key that can retire a leaked key | accepted |
| [0003](0003-route-on-the-phone-from-downloaded-road-packs.md) | Route on the phone from downloaded road packs | accepted |
| [0004](0004-prove-nearby-peers-with-challenge-response.md) | Prove nearby phones with a signed challenge | accepted |
| [0005](0005-english-text-is-the-translation-key.md) | The English text is the translation key | accepted |
| [0006](0006-one-lockfile-for-the-workspace.md) | One lockfile for the workspace | **proposed** |
