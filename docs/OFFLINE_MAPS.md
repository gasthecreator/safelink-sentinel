# Offline maps and directions

The app can work out directions to the sender of an alert **on the phone, with no internet**,
from a *map pack*: a small file of the roads in an area. It draws those roads, finds the
quickest way on foot or by car, and gives turn-by-turn directions. It does not use Google
Maps, map tiles or any online service when someone is using it.

## What it is, and is not

It is a **road map**: streets, paths and their names, the route, you and them. It has no
buildings, terrain, satellite view or place labels. The map itself knows nothing about closures,
damage or flooding: it knows only what **people nearby have reported** (see "Road reports" below),
so after a disaster the quickest route may still be impassable where nobody has reported it yet.
Treat it as a guide and use your eyes.

## Using it

Open an alert that includes the sender's position, then **Get directions**. Choose where you are
starting from (GPS, a saved place, or typed coordinates) and whether you are on foot or in a car.
If the sender's phone is close, **Find them by Bluetooth** takes over for the last few tens of
metres.

If an alert's position or your start is outside every pack on the phone, the screen says so and
the **Open in Maps app** button on the alert is the fallback.

## Road reports

From the home screen, **Report a road** lets you say what you can see where you are: **blocked**,
**got through**, or a **hazard** (flooding, wires down), with an optional note. The report goes out
over the mesh like an alert, to everyone in range now and anyone who arrives later (and is passed
on), and phones that hear it **route around blocked roads** and warn about hazards near the route.
Your own phone uses it straight away.

Reports come from other people's phones and can be wrong or malicious, so the rules lean toward
caution:

- A **blocked** report is believed for **12 hours**, then expires (a report is remembered for 24).
- It stays in force until the person who reported it says the road is passable, or **two different
  phones** do. **One stranger saying "passable" does not cancel it**; the screen shows it as
  *disputed*. Repeating "passable" from one phone still counts as one.
- Roads within **40 m** of a blocked report are avoided. If that leaves no route at all, the screen
  says so and offers **Show the route anyway** rather than quietly sending you through. **Ignore
  them** is always available.
- A closure reported right at your start or at their position never makes the trip impossible
  (you still need to leave, or to reach them); it is shown as a warning.
- Hazards do not change the route; they are listed if the route passes close to one.
- Reports are checked like everything else from the network: only real kinds and valid positions are
  accepted, notes are cleaned, and one phone can keep only its 30 newest reports (500 overall) so it
  cannot flood the rest out.
- A report says where its sender was when they sent it, and their phone's permanent ID is attached,
  like an alert.

What this cannot do: tell you about a closure nobody has reported, or tell a wrong report from a
right one. A report is a signed statement that *someone* said so, not proof.

## Making a pack for your area

The repo includes a sample pack for Grambling, Louisiana (`app/assets/maps/grambling-la.json`).
To make one for another area (needs internet, once, on your computer, not the phone):

```bash
cd app
node scripts/build-routing-pack.js \
  --name "Your Town" \
  --bbox SOUTH,WEST,NORTH,EAST \
  --out assets/maps/your-town.json
```

`--bbox` is the area in decimal degrees, for example `32.505,-92.745,32.545,-92.690`. The script
fetches the roads from OpenStreetMap through the public Overpass servers. An area bigger than one
small request is fetched in tiles (about 400 km2 each, with a pause between them), joined into
one pack, and retried if a server is busy. Finished tiles are kept next to the output (`--cache DIR`
to choose where), so a run that fails part-way carries on where it stopped. One pack can cover up to
1 square degree (about 10,000 km2, an estimated 20-25 MB from the measurement below, not yet tried on
a phone); for more, make several packs.
Roads that cross the edge of the area you asked for are included whole.

Measured with a real pack: a 1,300 km2 area (the whole of Lincoln Parish, Louisiana) is 2.8 MB, loads
in about 0.13 s and routes across it in about 60 ms on a laptop. Phones are slower, but the pack is read
once and kept in memory. A pack built from tiles is identical to one fetched in a single request.
Very large regions are better made from several packs than one.

To ship a pack inside the app, register it in `app/services/navigation/packs.js` by adding a line to `BUNDLED`:

```js
{ id: "your-town", load: () => require("../../assets/maps/your-town.json") },
```

Bundled packs make the app bigger, so only the small sample is bundled. Everything else is meant to
be **downloaded to the phone** (next section).

Size: the Grambling sample (about 4.4 x 5.2 km of a small town, 106 KB) works out to roughly 5 KB per
square kilometre. A dense city has many more roads per square kilometre, so expect several times that.

## Downloading maps to the phone

**Offline maps** (link at the bottom of the home screen, and a button when a route has no map)
lists the maps a publisher offers, and downloads them to the phone while there is internet.

How it is kept safe: the list of maps (the *catalog*) is signed with the publisher's private key,
and the app has the matching public key built in (`app/constants/maps.js`).

- The app checks the signature **before reading anything in the list**. An altered or forged list is refused.
- The list carries each map's size and SHA-256. A downloaded file with another size or hash is thrown away.
- The file must also load as a valid pack and cover the area the signed list promised.
- A list *older* than one already seen is refused, so an attacker cannot replay an old signed list.
- Downloads must be `https` (the build can allow `http` only for local testing), and map ids are
  restricted so they cannot be used to write elsewhere on the phone.
- A download goes to a temporary file and replaces nothing until every check passes. A failed,
  cancelled or interrupted download leaves the maps already on the phone untouched, and an update
  keeps the old version until the new one is verified.
- Downloads are one at a time, ask first above 10 MB, and refuse if the phone is short on space.
- Opening the Offline maps screen checks for new maps and updates. That is the only time the app
  contacts the map server on its own: it makes no network requests at startup.

What this does not do: it cannot prove a map is *accurate*, only that it is the one the publisher
signed. Whoever holds the signing key decides what every phone can download, so guard it.
Big maps download in 4 MB pieces that are kept on the phone, so a dropped connection, a cancel or an
app restart carries on from the last finished piece (a failed piece is retried a few times first). A
server that cannot do partial downloads gets a single download instead. Maps are not updated in the
background, and the app does not choose areas for you.

### Publishing maps (the person running the maps)

```bash
cd app
node scripts/pack-keys.js                      # once: writes ~/.safelink/pack-signing.key, prints the public key
# put the printed public key in constants/maps.js as MAP_CATALOG_PUBLIC_KEY and set MAP_CATALOG_URL

node scripts/publish-pack-catalog.js --key ~/.safelink/pack-signing.key \
  --base-url https://github.com/OWNER/REPO/releases/download/map-packs \
  --out dist/maps  assets/maps/your-town.json
```

This writes `catalog.json` and one versioned file per map (`your-town-v1.json`) into `dist/maps`.
Upload everything there to the `--base-url` location (any HTTPS host; a GitHub release works).
Run it again with the same `--out` to publish an update: the catalog's sequence goes up and only
changed maps get a new version. **Back up the private key and never commit it.** Until a public key
is set in `constants/maps.js`, downloads are switched off in the app (it fails closed).

## Things worth knowing

- **Coverage:** a pack fully covers the box you asked for. Roads crossing the edge are included
  whole but are only partial beyond it, so routes near the edge may be missing a road.
- **Walking vs driving:** walkers may use footpaths and steps and ignore one-way signs, but not
  motorways. Cars may not use footpaths or steps and obey one-way streets. Speeds are rough
  (walking 5 km/h, cars by road type).
- **Places off the roads:** if a position is far from any road in the pack the route starts at
  the nearest road and the screen says how far away that is; the dashed line on the map is that gap.
- **Directions:** a turn is announced only at a junction, and gentle bends on the same street are not.
  Names are whatever OpenStreetMap has, so the same road can be spelled two ways.
- **Live directions:** with a GPS start, **Start live directions** follows the phone along the route:
  distance to the next turn, distance and time left, a buzz when a turn is near. Leaving the route
  (two fixes more than about 40-120 m away, a few seconds apart; poor-accuracy fixes are ignored)
  works out a new route from where you are, at most once every 15 seconds. Reaching the end of the
  mapped road says so and gives their direction and distance, because they may be off the roads in the
  map; "arrived" only appears within 25 m of them. It needs the app open with the screen on: the app
  does not track you in the background or with the phone locked. Without live mode the route is worked
  out once; use **Try GPS again** to recalculate.

## Credit

Map data is © OpenStreetMap contributors, available under the
[Open Database Licence](https://www.openstreetmap.org/copyright). Packs carry that credit and the
screen shows it. Anything built from them must keep it.

## How it was checked

The router is checked against an independent shortest-path search on the real Grambling data (40
random trips each for walking and driving: same quickest time, a continuous line, sensible
directions), plus tests for one-way streets, disconnected roads, malformed or hostile pack files,
junction and bend wording, and speed on a 22,500-point grid. **Not yet checked:** a real phone
following a route outdoors, iOS at runtime, a pack for a whole city, and pack download.
