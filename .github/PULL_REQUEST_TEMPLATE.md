## What
<!-- One paragraph: what this changes. -->

## Why
<!-- The problem or requirement. Link the issue. -->
Closes #

## How
<!-- Approach, alternatives you rejected, known shortcomings. -->

## Testing
<!-- What you ran and what it proves. Include failure paths. -->
- [ ] Unit tests added or updated (`npm test`)
- [ ] Tried it on an emulator or device: <steps>

## NOT verified
<!-- Be specific: Bluetooth between two real phones, iOS at runtime, a screen reader, real GPS, the Spanish wording... -->
-

## Risk
- [ ] Safe across app versions (messages and map packs from older builds still work, or the change is noted)
- [ ] Changes what is protected or sent over the air: `docs/SECURITY.md` updated

## Checklist
- [ ] One purpose (refactors are separate)
- [ ] New user-visible text uses `t("...")` and has a Spanish entry
- [ ] New buttons and images have accessibility roles and labels
- [ ] Docs and `env.example` files updated
- [ ] No secrets or build output committed
