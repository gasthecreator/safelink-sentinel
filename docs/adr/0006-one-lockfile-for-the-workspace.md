---
status: proposed
date: 2026-10-17
decision-makers: the maintainer
---

# 0006. One lockfile for the workspace

## Context and Problem Statement
The repository is an npm workspace (`app`, `server`, `safelink-dashboard`) with a root `package-lock.json`, and CI installs
from it. But `app/`, `server/` and `safelink-dashboard/` **each also track their own** `package-lock.json`. `render.yaml`
builds the server and dashboard from their own folders (`cd server && npm install`), so those two lockfiles are live. Two
lockfiles for the same dependencies can drift (CI tests one set of versions and production runs another), and they produce
duplicate security alerts and duplicate Dependabot pull requests.

## Considered Options
- Keep all of them and accept the drift
- Build on Render from the workspace root (`npm ci && npm run build -w safelink-dashboard`, start with `npm start -w server`) and delete the three sub-lockfiles
- Stop being a workspace and keep each package separate

## Decision Outcome
Proposed: "build from the workspace root and delete the sub-lockfiles". Not applied yet because it changes how production
is built and it has not been tested against Render. When it is done, supersede the "watch `/server` and `/safelink-dashboard`"
entries in `.github/dependabot.yml`.

### Consequences
- Good: one resolved dependency set everywhere; half the update and alert noise.
- Bad / trade-offs: Render's build commands change and must be tested; the `app` sub-lockfile must also go, and anyone
  who ran `cd app && npm install` must use the root.

### Confirmation
A CI check that fails when a workspace folder contains a lockfile.
