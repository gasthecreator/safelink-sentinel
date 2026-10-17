# Repository settings

Settings that live in GitHub, not in the code, and need admin rights. They are written down here so the repository can be
rebuilt, reviewed and audited. Commands use the [GitHub CLI](https://cli.github.com/) (`gh`) logged in as the owner.
Nothing here is applied automatically.

Repository: `gasthecreator/safelink-sentinel`.

## 1. Security features

```bash
R=gasthecreator/safelink-sentinel

# Dependency graph and Dependabot alerts (the dependency-review workflow cannot run without the graph)
gh api -X PUT repos/$R/vulnerability-alerts

# Dependabot security updates (automatic PRs for vulnerable dependencies)
gh api -X PUT repos/$R/automated-security-fixes

# Private vulnerability reporting (SECURITY.md and CODE_OF_CONDUCT.md send people to it)
gh api -X PUT repos/$R/private-vulnerability-reporting
```

Already on: secret scanning and push protection.

When the dependency graph is on, remove `continue-on-error: true` from `.github/workflows/dependency-review.yml` so the
check blocks.

## 2. Protect `main`

[`.github/rulesets/protect-main.json`](../.github/rulesets/protect-main.json) is the ruleset. It requires a pull request,
requires the CI checks to pass, and blocks force-pushes and deletion of `main`. Repository admins can still merge a PR
without waiting for checks (`bypass_mode: pull_request`), but cannot push straight to `main`. Approvals are set to 0
because with one maintainer GitHub would not let the author approve their own PR; raise it, and turn on code-owner review
(`.github/CODEOWNERS`), when a second maintainer joins.

Apply it **after** the `Lint and format` job has run on `main` at least once (a required check that has never run blocks
every merge):

```bash
gh api -X POST repos/$R/rulesets --input .github/rulesets/protect-main.json
```

Check what GitHub made of it: `gh api repos/$R/rulesets`. To undo it: `gh api -X DELETE repos/$R/rulesets/<id>`.

## 3. Housekeeping

```bash
# Delete a PR's branch when it is merged; the wiki is unused
gh repo edit $R --delete-branch-on-merge --enable-wiki=false

# Make the repository findable
gh repo edit $R \
  --description "Offline-first emergency app: phones relay help requests over Bluetooth and give directions from maps stored on the phone" \
  --add-topic emergency --add-topic mesh-network --add-topic offline-first --add-topic react-native \
  --add-topic bluetooth-low-energy --add-topic openstreetmap
```

## 4. Not yet decided

- **Licence.** There is no `LICENSE` file; `package.json` says MIT. The copyright holder must be chosen by the maintainer
  (the code began as a hackathon baseline, so confirm who holds the rights) before a file is added.
- **First version.** No tag exists. Choose `0.x` or `1.0.0` when the first release is cut ([CHANGELOG.md](../CHANGELOG.md)).
- **Lockfiles.** See [ADR 0006](adr/0006-one-lockfile-for-the-workspace.md).
