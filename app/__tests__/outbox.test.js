const { createNetwork, boot, discover, settle } = require("./helpers/meshHarness");

let net;
beforeEach(() => {
  net = createNetwork();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("publish with nobody in range", () => {
  test("is kept, reported as queued (not delivered), and persisted", async () => {
    const alice = await boot(net, "alice");
    const summary = await alice.geo.broadcast(alice.id, "Need water", { priority: "high" });
    expect(summary).toMatchObject({ queued: true, success: 0, totalTargets: 0 });
    expect(alice.outbox.getStats()).toMatchObject({ ownWaiting: 1, ownDelivered: 0 });
    expect(JSON.parse(alice.store["@safelink_outbox"])).toHaveLength(1);
  });

  test("goes out when a device later comes into range, exactly once", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await alice.geo.broadcast(alice.id, "Need water", { priority: "high" });

    await discover(net, alice, bob); // bob arrives
    await alice.outbox.flush();
    expect(bob.inbox.map((m) => m.content)).toEqual(["Need water"]);
    expect(alice.outbox.getStats()).toMatchObject({ ownWaiting: 0, ownDelivered: 1 });

    await alice.outbox.flush();
    await alice.outbox.flush();
    expect(alice.transport.sent.filter((s) => s.to === bob.id)).toHaveLength(1); // not re-sent
    expect(bob.inbox).toHaveLength(1);
  });

  test("reaches several devices that arrive at different times", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    const carol = await boot(net, "carol");
    await alice.geo.broadcast(alice.id, "Shelter open", {});
    await discover(net, alice, bob);
    await alice.outbox.flush();
    await discover(net, alice, carol);
    await alice.outbox.flush();
    expect(bob.inbox).toHaveLength(1);
    expect(carol.inbox).toHaveLength(1);
  });
});

describe("restart", () => {
  test("a waiting message survives an app restart and is then delivered", async () => {
    const aliceStore = {};
    const alice = await boot(net, "alice", aliceStore);
    await alice.geo.broadcast(alice.id, "Still need help", {});
    net.devices.delete(alice.id);

    // "restart": brand-new module instances over the same phone storage
    const alice2 = await boot(net, "alice", aliceStore);
    expect(alice2.id).toBe(alice.id); // same identity too
    const bob = await boot(net, "bob");
    await alice2.outbox.init();
    expect(alice2.outbox.getStats().ownWaiting).toBe(1);
    await discover(net, alice2, bob);
    await alice2.outbox.flush();
    expect(bob.inbox.map((m) => m.content)).toEqual(["Still need help"]);
  });
});

describe("relaying", () => {
  test("a relay keeps what it received and passes it to a device that arrives later", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    const carol = await boot(net, "carol");

    await discover(net, alice, bob);
    await alice.geo.broadcast(alice.id, "Road flooded", { priority: "normal" });
    expect(bob.inbox).toHaveLength(1);

    // alice leaves; much later carol comes into range of bob only
    net.unlink(alice.id, bob.id);
    expect(carol.inbox).toHaveLength(0);
    await discover(net, bob, carol);
    await bob.outbox.flush();

    expect(carol.inbox.map((m) => m.content)).toEqual(["Road flooded"]);
    expect(carol.inbox[0].from).toBe(alice.id); // origin preserved
    expect(carol.inbox[0].hops).toBe(1); // one hop through bob
  });

  test("never sends a message back to the node that created it", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await discover(net, alice, bob);
    await discover(net, bob, alice);
    await alice.geo.broadcast(alice.id, "ping", {});
    await settle();
    await bob.outbox.flush();
    expect(bob.transport.sent.filter((s) => s.to === alice.id)).toHaveLength(0);
  });

  test("the hop limit stops the chain", async () => {
    const [a, b, c, d] = [
      await boot(net, "a"), await boot(net, "b"), await boot(net, "c"), await boot(net, "d"),
    ];
    await discover(net, a, b);
    await discover(net, b, c);
    await discover(net, c, d);
    // ttl 2: a -> b (hops 0), b -> c (hops 1), c must not pass it on
    await a.outbox.publish("short range", {}, { ttl: 2 });
    await settle(60);
    await c.outbox.flush();
    expect(b.inbox).toHaveLength(1);
    expect(c.inbox).toHaveLength(1);
    expect(d.inbox).toHaveLength(0);
  });

  test("a relayed message is not stored once its hop budget is used up", async () => {
    const a = await boot(net, "a");
    const b = await boot(net, "b");
    const env = await a.Env.createEnvelope({ id: "x1", content: "hi", ttl: 1 });
    expect(await b.outbox.addRelay(env)).toBe(false);
    expect(b.outbox.getStats().relaying).toBe(0);
  });
});

describe("store: false (automatic status alerts)", () => {
  test("sends to who is in range now but is not kept for later arrivals", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    const carol = await boot(net, "carol");

    await alice.alerts.triggerAutoAlert({
      type: "network_failure", message: "Connectivity failure", priority: "critical", radiusKm: 50,
    });
    expect(alice.outbox.getStats().total).toBe(0);
    expect(alice.store["@safelink_outbox"]).toBeUndefined();

    await discover(net, alice, bob);
    await alice.outbox.flush();
    expect(bob.inbox).toHaveLength(0);

    // but if someone is in range at the time, they do get it
    await discover(net, alice, carol);
    await alice.alerts.triggerAutoAlert({
      type: "network_failure", message: "Connectivity failure", priority: "critical", radiusKm: 50,
    });
    expect(carol.inbox).toHaveLength(1);
    expect(bob.inbox).toHaveLength(1);
  });
});

describe("failures", () => {
  test("a failed send is retried after the back-off, without duplicating to others", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    const carol = await boot(net, "carol");
    await discover(net, alice, bob);
    await discover(net, alice, carol);
    bob.transport; // (bob's own transport is irrelevant; failures are injected on alice's)
    alice.transport.failNext.add(bob.id);

    const summary = await alice.geo.broadcast(alice.id, "Medical help", { priority: "critical" });
    expect(summary).toMatchObject({ success: 1, failed: 1 });
    expect(carol.inbox).toHaveLength(1);
    expect(bob.inbox).toHaveLength(0);

    await alice.outbox.flush(); // bob still backing off
    expect(bob.inbox).toHaveLength(0);

    alice.outbox.backoff.set(bob.id, Date.now() - 1); // back-off elapsed
    await alice.outbox.flush();
    expect(bob.inbox).toHaveLength(1);
    expect(carol.inbox).toHaveLength(1); // carol not sent a second copy
    expect(alice.transport.sent.filter((s) => s.to === carol.id)).toHaveLength(1);
  });

  test("peers not seen recently are skipped", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await discover(net, alice, bob);
    const pb = await bob.Id.getPublicProfile();
    await alice.peerCache.storePeer({ ...pb, id: pb.id, bleId: "ble-bob", name: "bob",
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    const summary = await alice.geo.broadcast(alice.id, "hello", {});
    expect(summary.totalTargets).toBe(0);
    expect(bob.inbox).toHaveLength(0);
  });
});

describe("expiry, priority and limits", () => {
  test("messages are dropped after 24 hours", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await alice.geo.broadcast(alice.id, "old news", {});
    const realNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(realNow + 25 * 60 * 60 * 1000);
    await discover(net, alice, bob);
    await alice.outbox.flush();
    expect(bob.inbox).toHaveLength(0);
    expect(alice.outbox.getStats().total).toBe(0);
  });

  test("the most urgent message goes first", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await alice.geo.broadcast(alice.id, "low one", { priority: "low" });
    await alice.geo.broadcast(alice.id, "normal one", { priority: "normal" });
    await alice.geo.broadcast(alice.id, "critical one", { priority: "critical" });
    await discover(net, alice, bob);
    await alice.outbox.flush();
    expect(bob.inbox.map((m) => m.content)).toEqual(["critical one", "normal one", "low one"]);
  });

  test("over the cap, relayed messages are shed before our own", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    await alice.geo.broadcast(alice.id, "my own request", {});
    for (let i = 0; i < 205; i++) {
      const env = await bob.Env.createEnvelope({ id: `relay-${i}`, content: `r${i}`, ttl: 4 });
      await alice.outbox.addRelay(env);
    }
    const stats = alice.outbox.getStats();
    expect(stats.total).toBe(200);
    expect(stats.ownWaiting).toBe(1); // ours survived
  });
});

describe("what the sender is told", () => {
  test("delivered count and queued flag reflect reality", async () => {
    const alice = await boot(net, "alice");
    const bob = await boot(net, "bob");
    const none = await alice.geo.broadcast(alice.id, "first", {});
    expect(none).toMatchObject({ success: 0, queued: true });
    await discover(net, alice, bob);
    const some = await alice.geo.broadcast(alice.id, "second", {});
    expect(some).toMatchObject({ success: 1, queued: true });
  });
});
