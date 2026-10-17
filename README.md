# SafeLink Mesh AI

An offline-first emergency app: phones pass help requests and alerts to each other over Bluetooth when the internet and cell network are down, and give directions from maps stored on the phone.

[![CI](https://github.com/gasthecreator/safelink-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/gasthecreator/safelink-sentinel/actions/workflows/ci.yml)

**Status: pre-release.** The code builds and the automated tests pass on every change, but the mesh has not yet been tested between two real phones (Bluetooth cannot be tested in CI or on simulators). [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md) says exactly what has and has not been verified; read it before relying on the app in a real emergency.

## What it does

- **Mesh messaging.** Signed messages hop between nearby phones over Bluetooth Low Energy, stored and forwarded until someone is in range. Direct messages are sealed to the recipient; broadcast alerts are signed but not secret. A phone proves its identity to its neighbours before it can receive direct messages.
- **Help requests with a position.** GPS, a saved place, typed coordinates or a "where I am" note, attached to the request.
- **Offline directions.** Road maps are downloaded once (verified against a signed list), then routing, live turn-by-turn directions and spoken instructions work with no signal. Closed or flooded roads reported by other phones are routed around. See [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md).
- **Find help nearby.** The nearest hospitals, shelters, water points and similar places from the offline map.
- **Find the sender by Bluetooth** when you are within a few tens of metres.
- **Miles or kilometres, English or Spanish,** screen-reader labels, large-text support and a one-tap erase of personal data. See [docs/LANGUAGES.md](docs/LANGUAGES.md) and [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
- **A coordination side for when the internet is up:** an Express API server and a React dashboard (help requests, rescue log, shelters, first-aid guidance, relief feed). The phone app works without them.

The "AI" parts are heuristics, not trained models: `RouterAI` scores peers to pick a next hop, and the priority classifier matches urgent keywords. The server can call Google Gemini for first-aid and route recommendations when you give it an API key, and falls back to keyword matching without one.

## Repository layout

| Path | What it is |
|---|---|
| `app/` | React Native phone app (`screens/`, `components/`, `services/` for mesh, crypto, maps, navigation, i18n; tests in `__tests__/`) |
| `server/` | Express API (`routes/`, `controllers/`, `middleware/`, `utils/`; tests in `test/`) |
| `safelink-dashboard/` | React + Vite web dashboard |
| `docs/` | Design and operations docs (see below) |
| `scripts/` | `dev.js` (starts server + dashboard), Windows start scripts, `legacy/` |
| `app/scripts/` | Map-pack builder, catalog signing and publishing, release-key helper |
| `render.yaml`, `firebase.json`, `firestore.rules` | Deployment config (Render; the Firebase CLI expects these at the repo root) |

## Quick start

Needs Node.js 18 or newer (`.nvmrc` pins 20, which is what CI uses). Works on macOS, Linux and Windows.

```bash
npm ci                        # installs all three workspaces
cp server/env.example server/.env   # optional: add GEMINI_API_KEY / GOOGLE_MAPS_KEY for the AI and map features
npm run dev                   # API on http://localhost:4000, dashboard on http://localhost:5173
```

The dashboard's Relief Feed uses your own Firebase project: copy `safelink-dashboard/env.example` to `safelink-dashboard/.env` and fill in the `VITE_FIREBASE_*` values. The rest of the dashboard works without it.

The phone app:

```bash
npm run dev:app               # Metro bundler
cd app && npm run android     # or: npm run ios   (needs Android Studio / Xcode set up)
```

Testing the mesh needs two real phones: [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md).

## Tests

```bash
npm test               # server tests, then app tests
npm run test:app
npm run test:server
```

CI (`.github/workflows/ci.yml`) runs the app and server tests, bundles the JavaScript for both platforms, builds the dashboard, and builds the Android release APK and the iOS simulator app on every pull request.

## Documentation

| Doc | Read it for |
|---|---|
| [docs/mesh-architecture.md](docs/mesh-architecture.md) | How the app is organised |
| [docs/SECURITY.md](docs/SECURITY.md) | What is protected, what is not, and how to report a vulnerability |
| [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md) | Map packs, routing, publishing a signed catalog |
| [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md) | Testing on real phones, and what is still untested |
| [docs/RELEASING.md](docs/RELEASING.md) | Signing and handing a build to testers |
| [docs/LANGUAGES.md](docs/LANGUAGES.md) | Languages, and adding one |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | Screen readers, large text, what is untested |
| [docs/api-endpoints.md](docs/api-endpoints.md) | Every server endpoint |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying the server and dashboard to Render |

## Acknowledgments

Map data and place names come from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Optional AI features use Google Gemini.
