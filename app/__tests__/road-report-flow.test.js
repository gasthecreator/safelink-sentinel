// Phone A reports a blocked road; phone B, in range, receives it and its directions go round it.
const { createNetwork, boot, discover, settle } = require("./helpers/meshHarness");
const { loadPack } = require("../services/navigation/pack.js");
const { route, distanceM } = require("../services/navigation/router.js");

const { graph } = loadPack(require("../assets/maps/grambling-la.json"));
const campus = { latitude: 32.5266, longitude: -92.7165 };
const far = { latitude: 32.5405, longitude: -92.6975 };

let net;
beforeEach(() => {
  net = createNetwork();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const near = (geometry, p, m) => geometry.some(([la, lo]) => distanceM(la, lo, p.latitude, p.longitude) <= m);

test("a reported closure changes the receiving phone's route, and clearing it restores it", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  const carol = await boot(net, "carol");
  await discover(net, alice, bob);
  await discover(net, bob, carol);

  const plain = route(graph, campus, far, { mode: "walk" });
  expect(plain.ok).toBe(true);
  const [la, lo] = plain.geometry[Math.floor(plain.geometry.length / 2)];
  const spot = { latitude: la, longitude: lo, accuracyM: 6 };

  // Alice is standing at the blockage and says so
  await alice.roads.publish({ kind: "blocked", position: spot, note: "Tree across the road" });

  // Bob heard it and his directions avoid it
  const bobClosures = bob.roads.closures();
  expect(bobClosures).toHaveLength(1);
  const withReport = route(graph, campus, far, { mode: "walk", avoid: bobClosures });
  if (withReport.ok) {
    expect(near(withReport.geometry, spot, 40)).toBe(false);
    expect(withReport.detour.closures).toHaveLength(1);
  } else {
    expect(withReport.reason).toBe("blocked_by_reports");
  }

  // Carol is only in range of Bob, and still hears of it (the report is relayed)
  await bob.outbox.flush();
  await settle();
  expect(carol.roads.closures()).toHaveLength(1);

  // Alice says it is passable again: she is the one who reported it, so that clears it for everyone who hears
  await alice.roads.publish({ kind: "passable", position: spot });
  expect(bob.roads.closures()).toHaveLength(0);
  expect(route(graph, campus, far, { mode: "walk", avoid: bob.roads.closures() }).geometry).toEqual(plain.geometry);
});

test("a stranger's single 'passable' does not undo someone else's closure, two do", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  const mallory = await boot(net, "mallory");
  const dave = await boot(net, "dave");
  for (const other of [alice, mallory, dave]) await discover(net, other, bob);
  const spot = { latitude: 32.53, longitude: -92.71, accuracyM: 5 };

  await alice.roads.publish({ kind: "blocked", position: spot });
  await mallory.roads.publish({ kind: "passable", position: spot });
  expect(bob.roads.closures()).toEqual([expect.objectContaining({ kind: "blocked", disputed: true })]);

  await dave.roads.publish({ kind: "passable", position: spot });
  expect(bob.roads.closures()).toHaveLength(0);
});

test("a hostile phone cannot slip an invalid report past verification", async () => {
  const mallory = await boot(net, "mallory");
  const bob = await boot(net, "bob");
  await discover(net, mallory, bob);
  await mallory.outbox.publish("Road blocked", { type: "road_report", kind: "blocked", position: { latitude: 9999, longitude: 0 } });
  await mallory.outbox.publish("Road blocked", { type: "road_report", kind: "kaboom", position: { latitude: 32.5, longitude: -92.7 } });
  await mallory.outbox.publish("Road blocked", { type: "road_report", kind: "blocked" });
  expect(bob.roads.closures()).toEqual([]);
  expect(bob.roads.list()).toEqual([]);
});
