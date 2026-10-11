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
   within a few seconds.
7. Optionally repeat from B to A, and try **Status update**.

If nothing is in range the send screen says so instead of reporting success;
that is intended.

## What "working" looks like in the logs

Where logs are available (Android `adb logcat`, or an iOS Debug build, below),
these lines show each stage:

| Log line | Meaning |
|---|---|
| `Peripheral state: advertising` | this device is advertising and serving GATT |
| `Advertising as <id>` | its public device ID |
| `Starting device discovery...` / `Discovery finished`  | a scan cycle (10 s scan, every 30 s) |
| `Peer found: ... (<id>)` | a nearby node was found and its identity verified |
| `Sent <n>B to <id> in <k> frame(s), MTU <m>` | a message was written to a peer |
| `Received broadcast message ...` / `Received direct message ...` | a verified message arrived |

Android: `adb logcat | grep ReactNativeJS`.

iOS: Release builds do not show JavaScript logs. To see them, run a **Debug**
build from Xcode on the device while the Mac runs `cd app && npx react-native start`
(the device must reach the Mac over the network at launch); logs then appear in
Xcode's console. This route has not been exercised on a physical device.

## Troubleshooting

| Symptom | Things to check |
|---|---|
| Stuck on "0 devices" | Bluetooth on at both ends; permissions granted (iOS: Settings, SafeLink Mesh AI, Bluetooth; Android: app permissions); both apps in the foreground; wait the full minute; force-quit and reopen both |
| One device sees the other but not the reverse | the one that can't be seen isn't advertising: on Android check for `Peripheral state: ...` other than `advertising` (the Android emulator and some devices cannot advertise); on iOS check the Bluetooth permission |
| Found but message not delivered | look for `Send ... failed` in the logs; peers are retried after a 30 s back-off |
| Xcode: "failed to verify code signature" / bundle ID errors | use a unique bundle identifier; trust the developer certificate on the device |
| Build fails with missing `@react-native/...` files | `npm install` empties the hoisted `@react-native*` packages when the `app/node_modules` symlinks exist. Run `rm app/node_modules/react-native app/node_modules/@react-native app/node_modules/@react-native-community && npm install` (see `app/scripts/link-hoisted-modules.js`) |
| `pod install` fails on encoding | `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` first |

## Known limits

- **Foreground only, for now.** iOS restricts background Bluetooth heavily and
  Android behaviour in the background is untested. Keep the app open.
- **Discovery is periodic:** a 10 s scan every 30 s, so a new device can take up
  to about 40 s to appear, and a device that leaves disappears after about 90 s.
- **Relaying:** messages hop onward up to 4 times. This is exercised by a
  simulated three-phone test, not on hardware.
- **Emulators and simulators:** the iOS simulator has no Bluetooth. Android
  emulators can scan, but a given emulator may not support advertising.
- **Keys** are stored in the iOS Keychain and Android Keystore. On iOS they
  survive deleting and reinstalling the app, so the device keeps its ID.

## Results

Fill in after each run.

| Date | Device A | Device B | Found each other | Message delivered | Notes |
|---|---|---|---|---|---|
| | | | | | |
