# Releasing: getting the app onto other people's phones

This is the checklist for handing a build to someone else. For your own two test devices, see
[DEVICE_TESTING.md](DEVICE_TESTING.md).

## Before you build

- [ ] **Map publisher keys are set** in `app/constants/maps.js`: `MAP_CATALOG_PUBLIC_KEY` (everyday key) and
      `MAP_CATALOG_BACKUP_PUBLIC_KEY` (offline backup key). See "A backup key..." in [OFFLINE_MAPS.md](OFFLINE_MAPS.md).
      With no key, map downloads are off; with the wrong key, nothing downloads.
- [ ] **The maps are published** at the URL in `MAP_CATALOG_URL` (GitHub release `map-packs`), and the first
      download has been tried from a build with this key.
- [ ] **`ALLOW_INSECURE_PACK_URLS` is `false`** (a test checks this).
- [ ] The tests and CI are green on the commit you are releasing.
- [ ] You have read [SECURITY.md](SECURITY.md) and are comfortable with what it says the app does not protect.
- [ ] Version: set `"version"` in `app/package.json` (this becomes the version name people see). The version
      **code** must go up with every build you hand out, or phones will refuse to update (see below).

## Android

### Once: make your release key

```bash
cd app
bash scripts/android-release-key.sh
```

This writes the key to `~/.safelink/android-release.keystore` with random passwords and
`app/android/keystore.properties` pointing at it (both private, neither is committed).
**Back both up somewhere safe.** If you lose the key, phones will not accept updates to an app they installed
from an earlier build; people would have to uninstall (losing their data) and reinstall.

### Each release: build and check

```bash
cd app/android
SAFELINK_VERSION_CODE=2 ./gradlew assembleRelease -PrequireReleaseKey=true   # raise the number every release
```

The file is `app/android/app/build/outputs/apk/release/app-release.apk`. `-PrequireReleaseKey=true` makes the
build fail instead of quietly using the public debug key. Check who signed it:

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs app-release.apk
```

The certificate fingerprint must be the one the key script printed. If it says "CN=Android Debug", it is **not**
a release.

### Installing

- On a phone: send the APK (AirDrop, email, a download link) and open it; Android asks to allow installing
  from that source. Or over USB: `adb install -r app-release.apk`.
- Google Play needs an app bundle instead (`./gradlew bundleRelease`, signed the same way) and a Play Console
  account. That is not set up here.

### Building it in GitHub instead

`.github/workflows/release-build.yml` builds the signed APK when you push a tag like `v1.0.1`, or by hand from the
Actions tab. It needs four repository secrets (Settings, Secrets and variables, Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i ~/.safelink/android-release.keystore \| pbcopy` |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` from `keystore.properties` |
| `ANDROID_KEY_ALIAS` | `keyAlias` from `keystore.properties` |
| `ANDROID_KEY_PASSWORD` | `keyPassword` from `keystore.properties` |

The version code is the workflow run number, so it always goes up. The APK is a private workflow artifact
(30 days); nothing is published. The normal CI build (`ci.yml`) never has the key and is signed with the debug
key: it only proves the app builds.

## iOS

- **Your own devices (free Apple ID):** build from Xcode as in [DEVICE_TESTING.md](DEVICE_TESTING.md). The app
  stops opening after 7 days and must be reinstalled, and a free account allows 3 apps at once.
- **Other people's iPhones** (TestFlight or ad-hoc) needs a paid Apple Developer account ($99/year). That is
  not set up here, and the iOS release configuration, signing and App Store questions (the app asks for
  Bluetooth, location, and location in the background while live directions run) have not been exercised.

## What to tell testers

- The app works with **no internet** between phones in Bluetooth range; maps must be downloaded *beforehand*
  (Offline maps, home screen).
- It asks for Bluetooth and location. Live directions show a notification (Android) or the blue location
  indicator (iOS) while they run, and stop when you press Stop.
- It is a prototype: phones have only been tested one at a time so far (see the status in
  [DEVICE_TESTING.md](DEVICE_TESTING.md)). Do not rely on it as the only way to ask for help.

## Not set up

Play Store / App Store listings, crash reporting, automatic updates, an iOS release pipeline, a privacy policy page.
