# Offline maps and directions

The app can work out directions to the sender of an alert **on the phone, with no internet**,
from a *map pack*: a small file of the roads in an area. It draws those roads, finds the
quickest way on foot or by car, and gives turn-by-turn directions. It does not use Google
Maps, map tiles or any online service when someone is using it.

## What it is, and is not

It is a **road map**: streets, paths and their names, the route, you and them. It has no
buildings, terrain, satellite view or place labels. It follows the roads in the pack and
**cannot know about closures, damage, flooding or blocked roads**: after a disaster the quickest
route on the map may be impassable. Treat it as a guide and use your eyes.

## Using it

Open an alert that includes the sender's position, then **Get directions**. Choose where you are
starting from (GPS, a saved place, or typed coordinates) and whether you are on foot or in a car.
If the sender's phone is close, **Find them by Bluetooth** takes over for the last few tens of
metres.

If an alert's position or your start is outside every pack on the phone, the screen says so and
the **Open in Maps app** button on the alert is the fallback.

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
fetches the roads from OpenStreetMap through the public Overpass servers. It refuses areas larger
than 0.25 square degrees (roughly 50 km x 50 km), and a dense city may need splitting into
smaller pieces to stay within what the public servers allow; ask for one area at a time. For a whole county,
state or country, download an extract from [Geofabrik](https://download.geofabrik.de/) and
convert it to Overpass JSON; the converter (`scripts/lib/osmToPack.js`) takes that format.

Then register it in `app/services/navigation/packs.js` by adding a line to `PACKS`:

```js
{ id: "your-town", load: () => require("../../assets/maps/your-town.json") },
```

Size: the Grambling sample (about 4.4 x 5.2 km of a small town, 106 KB) works out to roughly 5 KB per
square kilometre. A dense city has many more roads per square kilometre, so expect several times that.
Packs bundled this way ship inside the app. Downloading packs to the phone before a disaster is
**not built yet**, and neither is choosing which areas a user keeps.

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
- **Position updates:** the route is worked out from one fix. It does not follow you as you
  move or re-route if you leave it; use **Try GPS again** to recalculate.

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
