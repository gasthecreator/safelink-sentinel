// A position travels with a request for help: sender -> relay -> recipient.
const { createNetwork, boot, discover, settle } = require("./helpers/meshHarness");

let net;
beforeEach(() => {
  net = createNetwork();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const position = (over = {}) => ({
  latitude: 30.5, longitude: -92.25, accuracyM: 9, fixedAt: Date.now() - 60000, ...over,
});

test("a request for help carries the sender's position to the recipient", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  await discover(net, alice, bob);
  await alice.alerts.createReliefRequestAndAlert(alice.id, {
    title: "Need water", description: "Need water at the school", priority: "high", location: position(),
  });

  const requests = await bob.alerts.getAlertFeed();
  expect(requests).toHaveLength(1);
  expect(requests[0].location).toMatchObject({ latitude: 30.5, longitude: -92.25, accuracyM: 9 });
  expect(requests[0].title).toBe("Need water - GENERAL");
});

test("the sender's own saved request keeps its position", async () => {
  const alice = await boot(net, "alice");
  await alice.alerts.createReliefRequestAndAlert(alice.id, {
    title: "Need water", description: "x", location: position(),
  });
  const [mine] = await alice.alerts.getAlertFeed();
  expect(mine.location).toMatchObject({ latitude: 30.5, longitude: -92.25 });
});

test("a request without a position still goes out, with none attached", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  await discover(net, alice, bob);
  await alice.alerts.createReliefRequestAndAlert(alice.id, { title: "Need help", description: "x", location: null });
  const [received] = await bob.alerts.getAlertFeed();
  expect(received.location).toBeNull();
});

test("the position survives a hop through a relay", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  const carol = await boot(net, "carol");
  await discover(net, alice, bob);
  await alice.alerts.createReliefRequestAndAlert(alice.id, { title: "Trapped", description: "x", location: position() });
  net.unlink(alice.id, bob.id);
  await discover(net, bob, carol); // carol only ever meets bob
  await bob.outbox.flush();
  await settle();
  const [received] = await carol.alerts.getAlertFeed();
  expect(received.location).toMatchObject({ latitude: 30.5, longitude: -92.25 });
});

test("a status alert (not a relief request) also carries a position", async () => {
  const alice = await boot(net, "alice");
  const bob = await boot(net, "bob");
  await discover(net, alice, bob);
  await alice.geo.broadcast(alice.id, "Safe at the shelter", { priority: "normal", position: position() });
  const [received] = await bob.alerts.getAlertFeed();
  expect(received.location).toMatchObject({ latitude: 30.5, longitude: -92.25 });
});

describe("positions from the network are never trusted", () => {
  test.each([
    ["out-of-range latitude", { latitude: 5000, longitude: 0 }],
    ["not numbers", { latitude: "30", longitude: "-92" }],
    ["NaN", { latitude: NaN, longitude: NaN }],
    ["not an object", "30,-92"],
  ])("a malicious sender's %s is dropped, not displayed", async (_n, bad) => {
    const mallory = await boot(net, "mallory");
    const bob = await boot(net, "bob");
    await discover(net, mallory, bob);
    // bypass our own sanitising: publish raw metadata, as a hostile client could
    await mallory.outbox.publish("[RELIEF] Fake - GENERAL\nx", { type: "relief", reliefId: "r-bad", position: bad });
    const [received] = await bob.alerts.getAlertFeed();
    expect(received).toBeDefined(); // the message itself still arrives
    expect(received.location).toBeNull(); // the bad position does not
  });

  test("GeoBroadcast also refuses to send an invalid position", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await discover(net, alice, bob);
    await alice.geo.broadcast(alice.id, "hi", { position: { latitude: 999, longitude: 0 } });
    expect(bob.inbox[0].meta.position).toBeUndefined();
  });
});
