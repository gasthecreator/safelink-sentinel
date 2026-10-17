# Contributing

Thanks for helping. This page is the shortest path from clone to merged change.

## Setup

Needs Node.js 18+ (`.nvmrc` pins 20, which CI uses).

```bash
git clone https://github.com/gasthecreator/safelink-sentinel.git
cd safelink-sentinel
npm ci            # installs the app, server and dashboard workspaces
npm test          # server tests, then app tests: must pass on a fresh clone
npm run dev       # API on :4000, dashboard on :5173
```

The phone app needs Android Studio or Xcode: see the README, and [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md) for the real-phone checks CI cannot do.

## Workflow

1. Open an issue first for anything non-trivial, so the approach is agreed before the work.
2. Branch from `main` (`feat/<topic>`, `fix/<topic>`, `docs/<topic>`). Keep branches short-lived.
3. One purpose per pull request, with tests. Refactors go in their own PR.
4. Run `npm test` locally. CI runs the same tests and also bundles the JavaScript for Android and iOS, builds the dashboard, the Android release APK and the iOS simulator app.
5. Open the PR using the template. Say what changed and why, and **what you did not verify**. This project keeps an explicit "not verified" list (Bluetooth between two real phones, iOS at runtime, and so on); please keep it honest.
6. Address review comments. A comment starting with `Nit:` is optional.

## Commit messages

Short, imperative summary in sentence case, saying what the change does ("Resume interrupted map downloads"), then a body that explains **why**. A `feat:`/`fix:`/`docs:`/`chore:` prefix is welcome but not required. Do not use "wip" or "fix stuff" in commits that will be merged.

## Standards

- New behaviour needs tests, including failure paths. A bug fix starts with a test that fails.
- User-visible text goes through `t("...")` and gets a Spanish entry in `app/services/i18n/locales/es.js`; the i18n test fails otherwise ([docs/LANGUAGES.md](docs/LANGUAGES.md)).
- Buttons and images need accessibility roles and labels; the accessibility test checks this ([docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)).
- Anything that changes what is protected or what crosses the wire updates [docs/SECURITY.md](docs/SECURITY.md) in the same PR.
- No secrets, no build output, no large binaries. `.env` files stay local; add new variables to the matching `env.example`.
- Update the docs in the same PR as the behaviour.

## Reporting bugs and security issues

Bugs: use the issue template. Vulnerabilities: see [SECURITY.md](SECURITY.md) (private report; do not open a public issue).
