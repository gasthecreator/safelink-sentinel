---
status: accepted
date: 2026-10-17
decision-makers: the maintainer
---

# 0001. Record architecture decisions

## Context and Problem Statement
Decisions with security or protocol consequences (what the app trusts, what crosses the air) were explained only in
pull-request text and in `docs/`, which describe what *is*, not what was weighed. A new contributor, or the maintainer in
a year, cannot tell a deliberate choice from an accident.

## Considered Options
- Keep explaining in PR descriptions and docs only
- A `docs/adr/` folder with one short record per decision

## Decision Outcome
Chosen option: "a `docs/adr/` folder", because the records live next to the code, are reviewed like code, and cost a
page each.

### Consequences
- Good: the reasons and the rejected options are findable.
- Bad: one more thing to remember; stale records mislead. Mitigation: a decision is superseded by a new ADR, never edited.

### Confirmation
Review: a reviewer asks for an ADR when a change meets the criteria in [README.md](README.md).
