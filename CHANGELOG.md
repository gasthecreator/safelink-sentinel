# Changelog

All notable changes to this project are recorded here, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. The project is **pre-release**: no version has been tagged yet, so everything below is under *Unreleased*. When a
first version is cut it will follow [Semantic Versioning](https://semver.org/) (the `1.0.0` in the `package.json` files is
a placeholder, not a release). The `map-packs` GitHub release holds downloadable map data, not an app version.

## [Unreleased]

### Added
- **Mesh and identity.** Real Bluetooth LE transport with native peripheral modules ([#2](https://github.com/gasthecreator/safelink-sentinel/pull/2)); private keys in the OS keychain ([#5](https://github.com/gasthecreator/safelink-sentinel/pull/5)); messages kept until someone is in range, a Diagnostics screen ([#7](https://github.com/gasthecreator/safelink-sentinel/pull/7)); a challenge-response proof of who a nearby phone is ([#31](https://github.com/gasthecreator/safelink-sentinel/pull/31)).
- **Positions.** The sender's GPS position attached to help requests ([#8](https://github.com/gasthecreator/safelink-sentinel/pull/8)); saved places, typed coordinates and a "where are you" note as fallbacks ([#9](https://github.com/gasthecreator/safelink-sentinel/pull/9)); a Bluetooth finder to walk toward the sender ([#10](https://github.com/gasthecreator/safelink-sentinel/pull/10)).
- **Offline directions.** Road router, map packs and route screen ([#11](https://github.com/gasthecreator/safelink-sentinel/pull/11)); road reports shared over the mesh and routed around ([#12](https://github.com/gasthecreator/safelink-sentinel/pull/12)); live directions that follow the phone and re-route ([#15](https://github.com/gasthecreator/safelink-sentinel/pull/15)), keep the screen on and speak ([#20](https://github.com/gasthecreator/safelink-sentinel/pull/20)), and keep going with the phone locked ([#23](https://github.com/gasthecreator/safelink-sentinel/pull/23)); one spelling per street ([#29](https://github.com/gasthecreator/safelink-sentinel/pull/29)); routing across several joined maps ([#32](https://github.com/gasthecreator/safelink-sentinel/pull/32)).
- **Maps.** Download map packs verified against a signed catalog ([#13](https://github.com/gasthecreator/safelink-sentinel/pull/13)) ([#14](https://github.com/gasthecreator/safelink-sentinel/pull/14)); resumable downloads ([#16](https://github.com/gasthecreator/safelink-sentinel/pull/16)); fast closure lookup and update check on open ([#17](https://github.com/gasthecreator/safelink-sentinel/pull/17)); tiled builds for bigger areas ([#18](https://github.com/gasthecreator/safelink-sentinel/pull/18)); a backup key that can retire a leaked signing key ([#21](https://github.com/gasthecreator/safelink-sentinel/pull/21)); maps near you ([#22](https://github.com/gasthecreator/safelink-sentinel/pull/22)).
- **Find help nearby**: hospitals, shelters, water points from the offline map ([#26](https://github.com/gasthecreator/safelink-sentinel/pull/26)).
- **Settings and reach.** Miles/feet or metres/kilometres ([#25](https://github.com/gasthecreator/safelink-sentinel/pull/25)); accessibility labels, contrast and large text ([#27](https://github.com/gasthecreator/safelink-sentinel/pull/27)); English and Spanish ([#33](https://github.com/gasthecreator/safelink-sentinel/pull/33)) ([#34](https://github.com/gasthecreator/safelink-sentinel/pull/34)); "Erase my data" ([#28](https://github.com/gasthecreator/safelink-sentinel/pull/28)).
- **Engineering.** CI for tests, JS bundles, dashboard, server, Android and iOS ([#4](https://github.com/gasthecreator/safelink-sentinel/pull/4)); a real-device testing guide ([#6](https://github.com/gasthecreator/safelink-sentinel/pull/6)); release signing and a signed-APK workflow ([#24](https://github.com/gasthecreator/safelink-sentinel/pull/24)).

### Changed
- Native iOS and Android builds boot the real app ([#1](https://github.com/gasthecreator/safelink-sentinel/pull/1)); the iOS home-screen name is "SafeLink Mesh AI" ([#3](https://github.com/gasthecreator/safelink-sentinel/pull/3)).
- `crypto-js` removed in favour of TweetNaCl; Wi-Fi Direct permissions fixed ([#5](https://github.com/gasthecreator/safelink-sentinel/pull/5)).

### Fixed
- A crash when the system text size changed while the app was open ([#28](https://github.com/gasthecreator/safelink-sentinel/pull/28)).
- Tapping a Home footer link could open the wrong screen when the links wrapped onto several rows ([#34](https://github.com/gasthecreator/safelink-sentinel/pull/34)).
- Spoken directions now use a voice for the app's language, and the Android "following your route" notification is translated ([#34](https://github.com/gasthecreator/safelink-sentinel/pull/34)).

### Security
- The receive path is hardened against spoofed ids, floods and replays, and a threat model is documented ([#19](https://github.com/gasthecreator/safelink-sentinel/pull/19)).
- The API server gained strict CORS, rate limits, an admin gate, input validation and safe file writes ([#30](https://github.com/gasthecreator/safelink-sentinel/pull/30)).
- Direct messages are sealed to the recipient and never handed to a device that has not proved its identity ([#31](https://github.com/gasthecreator/safelink-sentinel/pull/31)).

[Unreleased]: https://github.com/gasthecreator/safelink-sentinel/commits/main
