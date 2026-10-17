const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startServer } = require("./helpers");

const BIDI = String.fromCharCode(0x202e);

test("help requests", async (t) => {
  const s = await startServer({});
  t.after(() => s.close());

  await t.test("the payload the dashboard really sends is accepted and cleaned", async () => {
    const r = await s.call("POST", "/api/help-requests", {
      body: { message: `Trapped on the roof ${BIDI}please`, latitude: 32.5266, longitude: -92.7165, address: "Grambling", status: "pending" },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.request.message, "Trapped on the roof please");
    assert.equal(r.json.request.latitude, 32.5266);
    assert.ok(r.json.request.id && r.json.request.natureOfHelp && r.json.request.priority);
  });
  await t.test("unknown fields are dropped (no stuffing the file with whatever a caller likes)", async () => {
    const r = await s.call("POST", "/api/help-requests", {
      body: { message: "water", latitude: 1, longitude: 2, id: "x".repeat(500), isAdmin: true, huge: "y".repeat(50000), verified: true },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.request.isAdmin, undefined);
    assert.equal(r.json.request.huge, undefined);
    assert.equal(r.json.request.verified, undefined);
    assert.ok(r.json.request.id.length < 60, "a caller cannot choose a 500-character id");
  });
  await t.test("each bad input is refused with a reason", async () => {
    const cases = [
      [{ latitude: 1, longitude: 2 }, /message/i],
      [{ message: "x", latitude: 91, longitude: 2 }, /location|latitude/i],
      [{ message: "x", latitude: "north", longitude: 2 }, /location|latitude/i],
      [{ message: "x", latitude: 1 }, /location|longitude/i],
      [{ message: 42, latitude: 1, longitude: 2 }, /message/i],
      [{ message: "\u0000​  ", latitude: 1, longitude: 2 }, /message/i],
    ];
    for (const [body, pattern] of cases) {
      const r = await s.call("POST", "/api/help-requests", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.json.error + " " + r.json.message, pattern);
    }
    assert.equal((await s.call("POST", "/api/help-requests", { body: [1, 2] })).status, 400);
  });
  await t.test("a status can only be a real status, and the filter ignores junk", async () => {
    const made = await s.call("POST", "/api/help-requests", { body: { message: "need help", latitude: 3, longitude: 4 } });
    const id = made.json.request.id;
    assert.equal((await s.call("PATCH", `/api/help-requests/${id}/status`, { body: { status: "hacked" } })).status, 400);
    assert.equal((await s.call("PATCH", `/api/help-requests/${id}/status`, { body: { status: "accepted" } })).status, 200);
    const list = await s.call("GET", "/api/help-requests?status=%3Cscript%3E&limit=-5");
    assert.equal(list.status, 200);
  });
});

test("the exact payloads the dashboard and phone app send are kept as they were", async (t) => {
  const s = await startServer({});
  t.after(() => s.close());

  await t.test("the SOS button's request keeps its Critical priority", async () => {
    const r = await s.call("POST", "/api/help-requests", {
      body: { message: "🚨 EMERGENCY SOS ALERT - Immediate assistance required!", latitude: 32.5, longitude: -92.7, address: "Emergency Location", status: "pending", priority: "Critical" },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.request.priority, "Critical");
    assert.equal(r.json.request.status, "pending");
    assert.match(r.json.request.message, /EMERGENCY SOS/);
  });
  await t.test("without a priority the server still works one out from the message", async () => {
    const r = await s.call("POST", "/api/help-requests", { body: { message: "Please send water, we are trapped and bleeding", latitude: 32.5, longitude: -92.7 } });
    assert.equal(r.json.request.priority, "Critical");
  });
  await t.test("the status-update post keeps its marker", async () => {
    const r = await s.call("POST", "/api/help-requests", { body: { message: "We are safe at the church", latitude: 32.5, longitude: -92.7, address: "Location detected", type: "status_update" } });
    assert.equal(r.json.request.type, "status_update");
  });
  await t.test("every status the check-in form offers is kept, not turned into 'safe'", async () => {
    for (const status of ["safe", "caution", "danger", "evacuated"]) {
      const r = await s.call("POST", "/api/location-updates", { body: { latitude: 32.5, longitude: -92.7, status, message: "x", address: "y", timestamp: new Date().toISOString() } });
      assert.equal(r.json.status, status);
    }
  });
  await t.test("the dashboard's direct message and the app's rescue event", async () => {
    await s.call("POST", "/api/peers", { body: { id: "peer-9", name: "P" } });
    const m = await s.call("POST", "/api/messages", { body: { content: "Help is coming", senderId: "dashboard", recipientId: "peer-9", type: "direct", priority: "normal" } });
    assert.equal(m.status, 201);
    assert.equal(m.json.message.recipientId, "peer-9");
    assert.equal(m.json.message.type, "direct");
    const e = await s.call("POST", "/api/rescues", { body: { id: "rescue-1700000000000-ab12c", type: "ARRIVED", timestamp: new Date().toISOString(), alertId: "alert-1", reliefId: null, helperId: "device-1" } });
    assert.equal(e.status, 201);
    assert.equal(e.json.rescue.id, "rescue-1700000000000-ab12c");
    assert.equal(e.json.rescue.helperId, "device-1");
  });
});

test("rescues, messages, peers", async (t) => {
  const s = await startServer({});
  t.after(() => s.close());

  await t.test("a rescue event: only ACCEPT/ARRIVED, with its own known fields", async () => {
    const ok = await s.call("POST", "/api/rescues", { body: { type: "ACCEPT", alertId: "alert-1", helperId: "h1", distanceKm: 2.5, etaMinutes: 30, extra: "x" } });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.rescue.extra, undefined);
    assert.equal(ok.json.rescue.distanceKm, 2.5);
    assert.equal((await s.call("POST", "/api/rescues", { body: { type: "DELETE_EVERYTHING", alertId: "a" } })).status, 400);
    assert.equal((await s.call("POST", "/api/rescues", { body: { type: "ARRIVED" } })).status, 400);
    assert.equal((await s.call("POST", "/api/rescues", { body: { type: "ARRIVED", alertId: "a", distanceKm: -3 } })).json.rescue.distanceKm, undefined);
  });
  await t.test("a message needs content and a sender id; ids cannot be object-poisoning names", async () => {
    assert.equal((await s.call("POST", "/api/messages", { body: { content: "hi", senderId: "me" } })).status, 201);
    assert.equal((await s.call("POST", "/api/messages", { body: { content: "hi" } })).status, 400);
    assert.equal((await s.call("POST", "/api/messages", { body: { content: "hi", senderId: "__proto__" } })).status, 400);
    assert.equal((await s.call("POST", "/api/messages", { body: { content: "hi", senderId: "a/b" } })).status, 400);
  });
  await t.test("a peer is registered with only its known fields", async () => {
    const r = await s.call("POST", "/api/peers", { body: { id: "peer-1", name: "Maria's phone", rssi: -60, latitude: 32.5, longitude: -92.7, isAdmin: true, capabilities: ["ble", 5, "x".repeat(100)] } });
    assert.equal(r.status, 200);
    assert.equal(r.json.peer.isAdmin, undefined);
    assert.deepEqual(r.json.peer.capabilities.length, 2);
    assert.equal((await s.call("POST", "/api/peers", { body: { id: "constructor" } })).status, 400);
    assert.equal((await s.call("POST", "/api/peers", { body: { name: "no id" } })).status, 400);
  });
  await t.test("the Sentinel subscription refuses a poisoned user id and a bad position", async () => {
    assert.equal((await s.call("POST", "/api/sentinel/subscribe", { body: { user_id: "__proto__", name: "x", lat: 1, lon: 2 } })).status, 400);
    assert.equal((await s.call("POST", "/api/sentinel/subscribe", { body: { user_id: "u1", name: "x", lat: 500, lon: 2 } })).status, 400);
    const ok = await s.call("POST", "/api/sentinel/subscribe", { body: { user_id: "u1", name: "Sam", lat: 32.5, lon: -92.7 } });
    assert.equal(ok.status, 201);
  });
});

test("location check-ins", async (t) => {
  const s = await startServer({});
  t.after(() => s.close());

  await t.test("a valid check-in is stored and read back; junk is refused", async () => {
    const r = await s.call("POST", "/api/location-updates", { body: { latitude: 32.5, longitude: -92.7, status: "safe", message: "ok", reporter: "Jo" } });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "safe");
    assert.equal((await s.call("POST", "/api/location-updates", { body: { latitude: "x", longitude: 1 } })).status, 400);
    assert.equal((await s.call("POST", "/api/location-updates", { body: { latitude: 1, longitude: 200 } })).status, 400);
    const list = await s.call("GET", "/api/location-updates");
    assert.equal(list.json.length, 1);
  });
  await t.test("an unknown status falls back to safe; nearby validates its query", async () => {
    const r = await s.call("POST", "/api/location-updates", { body: { latitude: 32.51, longitude: -92.71, status: "<b>x</b>" } });
    assert.equal(r.json.status, "safe");
    assert.equal((await s.call("GET", "/api/location-updates/nearby?lat=abc&lon=1")).status, 400);
    const near = await s.call("GET", "/api/location-updates/nearby?lat=32.5&lon=-92.7&radius=2");
    assert.equal(near.json.length, 2);
    const far = await s.call("GET", "/api/location-updates/nearby?lat=10&lon=10");
    assert.equal(far.json.length, 0);
  });
  await t.test("simultaneous check-ins are all kept", async () => {
    const before = (await s.call("GET", "/api/location-updates")).json.length;
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.call("POST", "/api/location-updates", { body: { latitude: 30 + i / 100, longitude: -90 } })));
    const after = (await s.call("GET", "/api/location-updates")).json.length;
    assert.equal(after - before, 20);
  });
});

test("the files cannot grow for ever, and never end up half written", async (t) => {
  const s = await startServer({});
  t.after(() => s.close());

  await t.test("the diagnostics log keeps only the newest 1000 reports", async () => {
    const LogModel = require("../models/LogModel");
    for (let i = 0; i < 1010; i++) await LogModel.add({ n: i });
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "server_logs.json"), "utf8"));
    assert.equal(saved.length, 1000);
    assert.equal(saved[0].n, 10);
    assert.equal(saved[999].n, 1009);
  });
  await t.test("a write leaves no temporary files behind and the result is valid JSON", async () => {
    const { writeJsonAtomic } = require("../utils/atomicFile");
    const file = path.join(s.dir, "x.json");
    for (let i = 0; i < 50; i++) writeJsonAtomic(file, { i, pad: "z".repeat(1000) });
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).i, 49);
    assert.deepEqual(fs.readdirSync(s.dir).filter((f) => f.endsWith(".tmp")), []);
  });
});

test("the plain helpers", () => {
  const v = require("../utils/validate");
  assert.equal(v.id("abc-123_x.y:z@q"), "abc-123_x.y:z@q");
  for (const bad of ["", "a b", "a/b", "../x", "x".repeat(129), "__proto__", "constructor", 5, null]) assert.equal(v.id(bad), null, String(bad));
  assert.equal(v.latitude("32.5"), 32.5);
  for (const bad of ["", " ", "abc", NaN, Infinity, 90.0001, null, undefined, {}]) assert.equal(v.latitude(bad), null, String(bad));
  assert.equal(v.limit("9999"), 500);
  assert.equal(v.limit("abc"), 100);
  assert.equal(v.limit("0"), 100);
  assert.equal(v.recentIso("1999-01-01T00:00:00Z"), null);
  assert.equal(v.text("a" + String.fromCharCode(0) + "b" + String.fromCharCode(0x202e) + "c  d", 4), "a bc"); // a control character becomes a space, a direction mark vanishes
});

test("a peer entry keeps the fields the dashboard's device list reads", async (t) => {
  const s = await startServer({});
  t.after(() => s.close());
  const r = await s.call("POST", "/api/peers", { body: { id: "p1", deviceName: "Field radio", signalStrength: -72, distance: 1.4, capabilities: ["messaging"] } });
  assert.equal(r.json.peer.name, "Field radio");
  assert.equal(r.json.peer.rssi, -72);
  assert.equal(r.json.peer.distanceKm, 1.4);
});
