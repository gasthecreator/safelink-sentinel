# Security: what is protected, and what is not

SafeLink Mesh passes messages between phones with no server in between, so anyone within Bluetooth
range can talk to a phone running it. This page says what that means, in plain terms.

## What the app guarantees

| Protection | How |
| --- | --- |
| A message cannot be changed in transit, and its sender cannot be faked | Every message is signed (Ed25519). The sender's ID is derived from their public key, so an ID cannot be claimed without its private key. Only the hop counter, which relays bump, is outside the signature. |
| Direct messages are private | Sealed to the recipient's key (NaCl box); relays carry them but cannot read them. Broadcast alerts are signed but **not** secret: anyone nearby can read them. |
| Private keys stay on the phone | Kept in the iOS Keychain / Android Keystore (`SecureStore`), never in app storage, never synced. |
| Downloaded maps are the publisher's | The map list is signed; each map is checked against the list's SHA-256 and size and must load as a valid map for the promised area (see [OFFLINE_MAPS.md](OFFLINE_MAPS.md)). An old list cannot be replayed. |
| One sender cannot silence another | Messages are remembered by sender **and** id, so reusing someone else's message id does not make a phone drop the real message. |
| A flood cannot drain the phone | At most a burst of 30 incoming messages, then 2 a second, are even looked at; cheap checks (shape, age, duplicate) run before the costly signature check; unfinished Bluetooth transfers, stored relays per sender and stored relief requests per sender are all capped. |
| Replays look old, not new | The "seen" list survives app restarts, and an alert shows when it was **sent**. |
| Text from other phones is cleaned | Control and direction-changing characters are stripped, lengths capped, unknown priorities and bad positions dropped. |

## What the app cannot guarantee

These are limits of an open, serverless mesh, not bugs waiting for a fix.

1. **A valid signature is not trustworthiness.** It proves who sent a message and that it is unchanged.
   Anyone can make a new identity for free, so a stranger can send a convincing "evacuate now" alert or a
   fake road closure. The app treats every sender as unverified. Road reports from people nearby can be
   switched off ("Ignore them"), and a route can ignore closures.
2. **Fake identities can imitate a crowd.** A road report counts as confirmed or cleared when two
   different phones say so; one person with two keys can do that. The caps above limit how much they can
   store, not what they can claim.
3. **Another phone can pose as a nearby phone at the radio level.** The identity a phone offers over
   Bluetooth is public, so a nearby attacker can offer someone else's. They cannot read that person's
   private messages (those are sealed to the real key), but they could swallow messages meant for them. The
   fix is a challenge-and-response when connecting, which needs a change to the Bluetooth protocol and
   testing on real phones; it is not done.
4. **Jamming and denial of service.** Someone determined to keep a phone busy or block Bluetooth can.
   The caps make a sustained flood drop messages instead of draining the battery, but also mean a flood
   can crowd out real messages for as long as it lasts.
5. **Replays within a day.** A recorded genuine alert can be replayed for up to 24 hours. It will show its
   real send time, and a phone that already saw it ignores it, but a phone that never saw it will show it.
6. **Positions you send are readable.** An alert with your location lets every phone that receives it see
   where you are. That is the point of it, and it is off unless you include it.
7. **Data on the phone is not separately encrypted.** Alerts, saved places and road reports sit in normal
   app storage, protected only by the phone's own lock and sandbox. Private keys are the exception.
8. **Clocks.** Messages more than 5 minutes in the future or a day old are dropped, so a phone with a very
   wrong clock may miss or reject messages.

## Dependencies

`npm audit` reports many findings. They are almost all in development and build tooling (Metro, the React
Native CLI, Jest, Babel helpers) which is not part of the installed app, or in the optional server and
dashboard (`express`, `axios`, `react-router`, ...). The code that ships inside the phone app is a short
list: `react-native`, `tweetnacl`, `uuid`, AsyncStorage, `react-native-ble-plx`, `react-native-keychain`,
`react-native-svg`, `react-native-fs` and the navigation and geolocation packages. If you deploy the server
or dashboard, update their packages first (`npm audit fix` in a branch, then run the build); the React
Native packages need a React Native upgrade to clear, which is a separate piece of work.

## Reporting a problem

Open a private security advisory on the GitHub repository, or email the maintainer, rather than a public issue.
