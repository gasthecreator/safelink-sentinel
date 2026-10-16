// Hostile-input tests for everything a phone accepts from other phones.
const { createNetwork, boot, settle } = require("./helpers/meshHarness");
const { Reassembler, encodeFrames, MAX_OPEN_TRANSFERS, MAX_OPEN_PER_SOURCE } = require("../services/ble/BleProtocol.js");
const { sanitizeMultiline } = require("../services/location/position.js");

let net;
beforeEach(() => {
  net = createNetwork();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const bytesOf = (env) => Buffer.from(JSON.stringify(env), "utf8");

describe("a sender cannot make a phone discard someone else's message", () => {
  test("a different sender reusing a message id first does not block the real message", async () => {
    const carol = await boot(net, "carol");
    const honest = await boot(net, "honest");
    const attacker = await boot(net, "attacker");
    const fake = await attacker.Env.createEnvelope({ id: "same-id", content: "FAKE", ttl: 4 });
    const real = await honest.Env.createEnvelope({ id: "same-id", content: "REAL alert", ttl: 4 });
    await carol.relay.receive(bytesOf(fake));
    await carol.relay.receive(bytesOf(real));
    expect(carol.inbox.map((m) => m.content)).toEqual(["FAKE", "REAL alert"]);
  });

  test("the same sender's message is still de-duplicated", async () => {
    const carol = await boot(net, "carol");
    const honest = await boot(net, "honest");
    const real = await honest.Env.createEnvelope({ id: "x", content: "once", ttl: 4 });
    await carol.relay.receive(bytesOf(real));
    await carol.relay.receive(bytesOf(real));
    expect(carol.inbox).toHaveLength(1);
  });
});

describe("replays", () => {
  test("closing and reopening the app does not make a recorded alert new again", async () => {
    const store = {};
    const sender = await boot(net, "sender");
    const env = await sender.Env.createEnvelope({ id: "alert-1", content: "Evacuate now", ttl: 4 });
    const first = await boot(net, "phone", store);
    await first.relay.receive(bytesOf(env));
    expect(first.inbox).toHaveLength(1);
    await first.relay.saveSeen();
    const reopened = await boot(net, "phone-again", store); // same storage, fresh app
    await reopened.relay.receive(bytesOf(env));
    expect(reopened.inbox).toHaveLength(0);
  });

  test("an alert shows when it was sent, not when it was replayed", async () => {
    const carol = await boot(net, "carol");
    const sender = await boot(net, "sender");
    const env = await sender.Env.createEnvelope({ id: "old", content: "Road closed", meta: { priority: "high" }, ttl: 4 });
    env.ts = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    // re-sign with the new timestamp so it is a genuine old message
    env.sig = await sender.Id.signBytes(
      require("../services/ble/codec.js").utf8Encode(JSON.stringify(["safelink/1", env.v, env.id, env.type, env.from, env.fromSign, env.fromBox, env.to, env.ts, env.ttl, env.body]))
    );
    await carol.relay.receive(bytesOf(env));
    const feed = await carol.alerts.getAlertFeed();
    const shown = feed.find((a) => a.title === "Road closed");
    expect(Date.now() - Date.parse(shown.timestamp)).toBeGreaterThan(4.9 * 3600 * 1000);
  });
});

describe("flooding", () => {
  // The receive budget refills with real time, so these tests freeze the clock: otherwise how many
  // messages get through would depend on how fast the machine builds the test envelopes.
  const freezeClock = () => {
    let now = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => now);
    return { advance: (ms) => { now += ms; } };
  };

  test("a sustained flood is dropped after a burst; the phone does not verify them all", async () => {
    const carol = await boot(net, "carol");
    const spammer = await boot(net, "spammer");
    const verify = jest.spyOn(carol.Id, "verifyBytes");
    const envelopes = [];
    for (let i = 0; i < 200; i++) envelopes.push(bytesOf(await spammer.Env.createEnvelope({ id: `s${i}`, content: `spam ${i}`, ttl: 1 })));
    freezeClock();
    for (const bytes of envelopes) await carol.relay.receive(bytes);
    expect(carol.inbox).toHaveLength(30); // exactly the burst allowance
    expect(verify.mock.calls.length).toBe(30); // nothing beyond the budget was even checked
  });

  test("the budget comes back with time, so real messages are accepted after a flood", async () => {
    const carol = await boot(net, "carol");
    const spammer = await boot(net, "spammer");
    const honest = await boot(net, "honest");
    const spam = [];
    for (let i = 0; i < 60; i++) spam.push(bytesOf(await spammer.Env.createEnvelope({ id: `s${i}`, content: "spam", ttl: 1 })));
    const real = bytesOf(await honest.Env.createEnvelope({ id: "real", content: "real", ttl: 4 }));
    const clock = freezeClock();
    for (const bytes of spam) await carol.relay.receive(bytes);
    const before = carol.inbox.length;
    await carol.relay.receive(real);
    expect(carol.inbox.length).toBe(before); // still empty-handed right after the flood
    clock.advance(10000); // ten seconds later
    await carol.relay.receive(real);
    expect(carol.inbox.map((m) => m.content)).toContain("real");
  });

  test("garbage and expired messages are rejected before any signature is checked", async () => {
    const carol = await boot(net, "carol");
    const sender = await boot(net, "sender");
    const verify = jest.spyOn(carol.Id, "verifyBytes");
    await carol.relay.receive(Buffer.from("not json"));
    await carol.relay.receive(Buffer.from(JSON.stringify({ id: 5 })));
    const old = await sender.Env.createEnvelope({ id: "o", content: "old", ttl: 4 });
    old.ts = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    await carol.relay.receive(bytesOf(old));
    const future = await sender.Env.createEnvelope({ id: "f", content: "future", ttl: 4 });
    future.ts = new Date(Date.now() + 3600 * 1000).toISOString();
    await carol.relay.receive(bytesOf(future));
    expect(verify).not.toHaveBeenCalled();
    expect(carol.inbox).toHaveLength(0);
  });

  test("unfinished transfers are bounded in total and per source", () => {
    const r = new Reassembler();
    const frame = (transferId) => encodeFrames(new Uint8Array(400), 50, transferId)[0]; // first of several frames
    for (let i = 0; i < 300; i++) r.push(`src-${i}`, frame(i));
    expect(r.transfers.size).toBeLessThanOrEqual(MAX_OPEN_TRANSFERS);
    const r2 = new Reassembler();
    for (let i = 0; i < 50; i++) r2.push("one-source", frame(i));
    expect(r2.transfers.size).toBeLessThanOrEqual(MAX_OPEN_PER_SOURCE);
  });

  test("a transfer that is being finished is not the one thrown away", () => {
    const r = new Reassembler();
    const payload = new Uint8Array(300).fill(7);
    const frames = encodeFrames(payload, 50, 1);
    r.push("me", frames[0]);
    for (let i = 0; i < 3; i++) r.push("me", encodeFrames(new Uint8Array(400), 50, 100 + i)[0]);
    let done = null;
    for (const f of frames.slice(1)) done = r.push("me", f) || done;
    expect(done && done.length).toBe(300);
  });
});

describe("text from other phones is cleaned before it is shown", () => {
  test("control and direction-changing characters are stripped, length capped, unknown priority ignored", async () => {
    const carol = await boot(net, "carol");
    const sender = await boot(net, "sender");
    const evil = "Safe‮exe.txt\u0000 line1\nline2" + "A".repeat(5000);
    const env = await sender.Env.createEnvelope({ id: "e1", content: evil, meta: { priority: "<script>", where: "x‮y" }, ttl: 4 });
    await carol.relay.receive(bytesOf(env));
    const alert = (await carol.alerts.getAlertFeed())[0];
    expect(alert.description).not.toMatch(/[‮\u0000]/);
    expect(alert.description.length).toBeLessThanOrEqual(2000);
    expect(alert.description).toContain("line1\nline2");
    expect(alert.title.length).toBeLessThanOrEqual(120);
    expect(alert.priority).toBe("normal");
    expect(alert.where).not.toMatch(/‮/);
  });

  test("sanitizeMultiline keeps a few lines and drops the rest", () => {
    const text = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    expect(sanitizeMultiline(text).split("\n")).toHaveLength(20);
    expect(sanitizeMultiline("\u0000‮")).toBeNull();
    expect(sanitizeMultiline(42)).toBeNull();
  });
});

describe("relief requests from other phones are limited", () => {
  const relief = (sender, i) =>
    sender.Env.createEnvelope({ id: `rel-${i}`, content: `[RELIEF] need ${i}`, meta: { type: "relief", reliefId: `R${i}`, priority: "high" }, ttl: 4 });

  test("a request id cannot be claimed by another sender, and one sender keeps at most 5", async () => {
    const carol = await boot(net, "carol");
    const honest = await boot(net, "honest");
    const attacker = await boot(net, "attacker");
    await carol.relay.receive(bytesOf(await relief(attacker, 1))); // attacker takes "R1" first
    await carol.relay.receive(bytesOf(await relief(honest, 1)));  // the honest "R1" is still accepted
    await settle();
    const open = await carol.alerts.getOpenReliefRequests();
    expect(open.map((r) => r.requesterId).sort()).toEqual([attacker.id, honest.id].sort());
    carol.relay.tokensAt = Date.now();
    for (let i = 2; i < 12; i++) {
      carol.relay.tokens = 30;
      await carol.relay.receive(bytesOf(await relief(attacker, i)));
    }
    await settle();
    const mine = (await carol.alerts.getOpenReliefRequests()).filter((r) => r.requesterId === attacker.id);
    expect(mine.length).toBe(5);
    expect((await carol.alerts.getOpenReliefRequests()).some((r) => r.requesterId === honest.id)).toBe(true);
  });
});
