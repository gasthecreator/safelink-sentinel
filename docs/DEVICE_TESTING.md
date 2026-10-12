# Testing on real devices

Bluetooth Low Energy cannot be tested on simulators or in CI, so the real mesh
(two phones finding each other and passing a message) has to be checked by hand
on physical devices. This is the checklist.

**Status:** the BLE transport, native peripheral modules and crypto are merged and
build on both platforms, and a single Android phone has been confirmed to start
advertising and scanning. **No two-device message exchange has been verified yet.**
Run this and record the result in the table at the end.

## What you need

- **Two** physical devices (any mix of iPhone, iPad and Android phones)
- A Mac with Xcode for iOS devices; Node 20+ and the Android SDK for Android
- A USB cable per device for the first install
- iOS: an Apple ID (a free one works). Android: nothing

Free disk space matters: an Xcode build needs about 2 GB.

## iOS (iPhone / iPad)

1. **Developer Mode** on each device: plug it into the Mac and open Xcode once
   so the device shows up, then Settings, Privacy & Security, Developer Mode,
   turn on and restart. The option only appears after Xcode has seen the device.
2. **Sign in to Xcode:** Settings, Accounts, add your Apple ID.
3. **Install dependencies** (from the repo root):

   ```bash
   npm install
   cd app/ios && pod install
   ```

   If `npm install` complains or later builds fail with missing `@react-native`
   files, see "Troubleshooting".
4. **Open the workspace** (not the `.xcodeproj`):

   ```bash
   open app/ios/SafeLinkMesh.xcworkspace
   ```
5. **Signing:** select the `SafeLinkMesh` target, Signing & Capabilities, tick
   "Automatically manage signing" and choose your Personal Team. Change the
   Bundle Identifier to something unique to you (for example
   `com.yourname.safelinkmesh`): `com.safelink.mesh` may already be taken for
   free accounts. **Do not commit this change.**
6. **Build configuration:** Product, Scheme, Edit Scheme, Run, set Build
   Configuration to **Release**. A Release build embeds the JavaScript, so
   nothing has to be running on the Mac.
7. **Run on the first device:** choose it in the device menu and press Run
   (Cmd+R). If iOS says "Untrusted Developer", go to Settings, General, VPN &
   Device Management and trust your Apple ID.
8. **Repeat for the second device.**

A Release build for a physical device has been compile-checked (unsigned); the
signing and install steps above depend on your Apple ID and have not been run.

Free Apple ID limits: the installed app expires after 7 days (reinstall from
Xcode), and a free account can have at most 3 apps installed at once.

## Android

Either build locally:

```bash
cd app/android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

or download the `app-release-apk` artifact from any CI run on GitHub (Actions,
open a run, Artifacts) and `adb install -r` it. On Android 12+ the app asks for
"Nearby devices" (Bluetooth scan, connect, advertise and nearby Wi-Fi); on
Android 11 and earlier it asks for Location, which Android requires for BLE
scanning. Allow them.

`gradle.properties` sets `org.gradle.java.home` to a Homebrew JDK 17 path on the
maintainer's Mac. On another machine change it or pass
`-Dorg.gradle.java.home=<your JDK 17>`.

## The test

1. Turn **Bluetooth on** on both devices. Wi-Fi and internet are not needed.
2. Open the app on both and tap through onboarding. Allow the Bluetooth (and
   location, if asked) prompts.
3. Keep both screens **on** and the app in the **foreground**, within a few
   metres of each other. Background operation is not reliable yet (see limits).
4. Wait up to a minute. The home screen starts at "0 devices" and "Unstable
   connection". Each device should then list the other under **Nearby devices**
   and the count should read 1.
5. On device A tap **Request help**, type a short message and send. The result
   line on A should say it was delivered to 1 nearby device.
6. On device B the message should appear under **Active alerts & requests**
   within a few seconds. Tap it to read the full message.
7. Optionally repeat from B to A, and try **Status update**.

### Store-and-forward check (messages wait for someone to arrive)

A message sent with nobody in range is not lost: it is kept for 24 hours and
sent to every device that later comes into range.

1. Close the app on device B (or move it out of range).
2. On A send a **Request help**. The screen should say it was **not delivered
   yet** and will be sent automatically. The home screen should show
   "1 message waiting".
3. Now open the app on B within range of A. Within about a minute B should show
   the message under Active alerts, and A's "waiting" banner should disappear.
4. Optional: force-quit and reopen A while a message is still waiting; the
   waiting count should survive the restart.

If nothing is in range the send screen says so instead of reporting success;
that is intended.

## Seeing what the app is doing: the Diagnostics screen

Release builds on iOS show no console, so the app has its own. On the home
screen scroll to the bottom and tap **Diagnostics**. It shows live status and
the recent log:

| Status line | Healthy value |
|---|---|
| Keys in secure storage | yes |
| BLE stack present | yes |
| Bluetooth ready (permissions + powered on) | yes |
| Scanning now | yes some of the time (10 s scan every 30 s) |
| Peripheral module linked | yes |
| Advertising | `advertising` (Android emulators and some devices report `unsupported`) |
| Nearby devices | the other device, with its signal strength |
| Messages waiting for someone in range | 0 once delivered |

Tap **Share status + log** to send the whole thing (AirDrop, Messages, email,
Notes) when reporting a problem. This is the first thing to do if a test fails.

Log lines that show each stage:

| Log line | Meaning |
|---|---|
| `Peripheral state: advertising` | this device is advertising and serving GATT |
| `Advertising as <id>` | its public device ID |
| `Starting device discovery...` / `Discovery finished` | a scan cycle |
| `Peer found: ... (<id>)` | a nearby node was found and its identity verified |
| `Sent <n>B to <id> in <k> frame(s), MTU <m>` | a message was written to a peer |
| `Received broadcast message ...` | a verified message arrived |
| `[Outbox] Loaded <n> waiting message(s)` | saved messages restored at start |

Android also supports `adb logcat | grep ReactNativeJS`.

## Troubleshooting

| Symptom | Things to check |
|---|---|
| Stuck on "0 devices" | open Diagnostics first (it says which of permissions / power / advertising is wrong); Bluetooth on at both ends; permissions granted (iOS: Settings, SafeLink Mesh AI, Bluetooth; Android: app permissions); both apps in the foreground; wait the full minute; force-quit and reopen both |
| One device sees the other but not the reverse | the one that can't be seen isn't advertising: on Android check for `Peripheral state: ...` other than `advertising` (the Android emulator and some devices cannot advertise); on iOS check the Bluetooth permission |
| Found but message not delivered | it stays queued and is retried automatically (a failed peer is retried after 30 s); Diagnostics shows the waiting count and `Send ... failed` lines |
| Xcode: "failed to verify code signature" / bundle ID errors | use a unique bundle identifier; trust the developer certificate on the device |
| Build fails with missing `@react-native/...` files | `npm install` empties the hoisted `@react-native*` packages when the `app/node_modules` symlinks exist. Run `rm app/node_modules/react-native app/node_modules/@react-native app/node_modules/@react-native-community && npm install` (see `app/scripts/link-hoisted-modules.js`) |
| `pod install` fails on encoding | `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` first |

## Known limits

- **Foreground only, for now.** iOS restricts background Bluetooth heavily and
  Android behaviour in the background is untested. Keep the app open.
- **Discovery is periodic:** a 10 s scan every 30 s, so a new device can take up
  to about 40 s to appear, and a device that leaves disappears after about 90 s.
- **Relaying:** messages hop onward (up to 4 hops, 6 for high and critical
  priority) and are kept so devices that arrive later still receive them. This
  is exercised by a simulated multi-phone test, not on hardware.
- **Alerts are signed but not encrypted:** requests for help are broadcast so
  any nearby phone can read and relay them. Nobody can alter or forge one, but
  anyone in range can read it. Direct encrypted messaging exists in the code but
  has no screen yet.
- **Location is not attached to alerts yet**, so received alerts show text only.
- **Emulators and simulators:** the iOS simulator has no Bluetooth. Android
  emulators can scan, but a given emulator may not support advertising.
- **Keys** are stored in the iOS Keychain and Android Keystore. On iOS they
  survive deleting and reinstalling the app, so the device keeps its ID.

## Results

Fill in after each run.

| Date | Device A | Device B | Found each other | Message delivered | Notes |
|---|---|---|---|---|---|
| | | | | | |
