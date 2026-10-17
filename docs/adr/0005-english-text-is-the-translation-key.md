---
status: accepted
date: 2026-10-17
decision-makers: the maintainer
---

# 0005. The English text is the translation key

Recorded afterwards from PR #33 and [docs/LANGUAGES.md](../LANGUAGES.md).

## Context and Problem Statement
The app must work in English and Spanish, with more languages later. Text appears in screens and also in services (turn
instructions, spoken prompts, errors). How is text identified, and how do we keep the translations complete?

## Considered Options
- Opaque keys (`home.request_help`) with a catalog per language
- The English text itself as the key (`t("Request help")`); English needs no catalog
- A heavyweight i18n library

## Decision Outcome
Chosen option: "English text as the key", with `tp()` for plurals, `{name}` placeholders, and `N_()` to mark text defined at
module level. A missing translation shows readable English, never a blank or a code. A scanner (`app/scripts/lib/i18nScan.js`)
and tests fail on unwrapped screen text, missing translations, placeholder mismatches and stale entries, so completeness is
enforced and not hoped for.

### Consequences
- Good: code reads naturally, no key bookkeeping, safe fallback, no dependency.
- Bad / trade-offs: editing an English sentence changes its key, so its translations must be updated with it; the scanner
  cannot see text assembled from fragments (prefer whole phrases with placeholders); plural rules for languages beyond
  English and Spanish need work first.

### Confirmation
`app/__tests__/i18n.test.js` in CI.
