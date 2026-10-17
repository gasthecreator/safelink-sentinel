const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startServer } = require("./helpers");

const ADMIN = "a".repeat(32);

test("headers, CORS and errors", async (t) => {
  const s = await startServer({ ADMIN_TOKEN: ADMIN });
  t.after(() => s.close());

  await t.test("every response carries the security headers and no X-Powered-By", async () => {
    const r = await s.call("GET", "/health");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(r.headers.get("x-powered-by"), null);
  });

  await t.test("an allowed origin gets CORS headers, another does not", async () => {
    const ok = await s.call("GET", "/health", { headers: { Origin: "https://dash.example" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://dash.example");
    const evil = await s.call("GET", "/health", { headers: { Origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    const none = await s.call("GET", "/health");
    assert.equal(none.status, 200); // the phone app and curl send no Origin
  });

  await t.test("a preflight from a stranger is not approved", async () => {
    const r = await s.call("OPTIONS", "/api/help-requests", { headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });

  await t.test("bad JSON is a 400 and an oversize body a 413, never a stack trace", async () => {
    const bad = await s.call("POST", "/api/help-requests", { raw: "{not json", headers: { "Content-Type": "application/json" } });
    assert.equal(bad.status, 400);
    assert.doesNotMatch(bad.text, /at .*\(.*\.js/);
    const big = await s.call("POST", "/api/help-requests", { body: { message: "x".repeat(200000) } });
    assert.equal(big.status, 413);
  });

  await t.test("unknown paths are a plain 404", async () => {
    const r = await s.call("GET", "/api/nothing-here");
    assert.equal(r.status, 404);
  });
});

test("admin-only actions", async (t) => {
  const on = await startServer({ ADMIN_TOKEN: ADMIN });
  const off = await startServer({});
  t.after(() => Promise.all([on.close(), off.close()]));

  await t.test("clearing rescues, removing a peer and system alerts need the admin token", async () => {
    for (const [method, p] of [["DELETE", "/api/rescues"], ["DELETE", "/api/peers/abc"], ["POST", "/api/sentinel/alerts/push"], ["GET", "/api/sentinel/test-process"]]) {
      assert.equal((await on.call(method, p, { body: method === "POST" ? { user_id: "u", message: "m" } : undefined })).status, 401, `${method} ${p} without a token`);
      assert.equal((await on.call(method, p, { headers: { Authorization: "Bearer wrong" + "x".repeat(30) } })).status, 401, `${method} ${p} with a wrong token`);
    }
  });
  await t.test("with the right token the action goes through", async () => {
    const r = await on.call("DELETE", "/api/rescues", { headers: { Authorization: `Bearer ${ADMIN}` } });
    assert.equal(r.status, 200);
  });
  await t.test("with no ADMIN_TOKEN configured the actions are off for everyone, even a guess", async () => {
    for (const token of ["", "undefined", "null", "Bearer "]) {
      const r = await off.call("DELETE", "/api/rescues", { headers: { Authorization: token } });
      assert.equal(r.status, 503);
    }
  });
  await t.test("a too-short ADMIN_TOKEN is treated as not configured", async () => {
    const weak = await startServer({ ADMIN_TOKEN: "short" });
    t.after(() => weak.close()); // closed even if the assertion below fails
    const r = await weak.call("DELETE", "/api/rescues", { headers: { Authorization: "Bearer short" } });
    assert.equal(r.status, 503);
  });
});

test("rate limits", async (t) => {
  const s = await startServer({ RATE_LIMIT_PER_MINUTE: "1000" });
  t.after(() => s.close());

  await t.test("writes are limited to 40 a minute per client, and the answer says when to retry", async () => {
    let last;
    let blockedAt = 0;
    for (let i = 1; i <= 45; i++) {
      last = await s.call("POST", "/logs/diagnostics", { body: { n: i } });
      if (last.status === 429 && !blockedAt) blockedAt = i;
    }
    assert.equal(blockedAt, 41);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get("retry-after")) >= 1);
  });

  await t.test("reads are not caught by the write limit", async () => {
    const r = await s.call("GET", "/api/peers");
    assert.equal(r.status, 200);
  });

  await t.test("the costly endpoints have a low limit of their own", async () => {
    let blockedAt = 0;
    for (let i = 1; i <= 15; i++) {
      const r = await s.call("GET", "/api/weather/alerts"); // 400 (no coordinates) still counts as a call
      if (r.status === 429 && !blockedAt) blockedAt = i;
    }
    assert.equal(blockedAt, 13);
  });

  await t.test("/health is never limited, so the host's health check cannot be locked out", async () => {
    for (let i = 0; i < 60; i++) assert.equal((await s.call("GET", "/health")).status, 200);
  });
});

test("the Maps key endpoint never hands out the general Google key", async (t) => {
  const saved = { m: process.env.GOOGLE_MAPS_KEY, g: process.env.GOOGLE_API_KEY };
  process.env.GOOGLE_API_KEY = "PAID-GEMINI-KEY";
  delete process.env.GOOGLE_MAPS_KEY;
  const s = await startServer({});
  t.after(async () => {
    await s.close();
    if (saved.m === undefined) delete process.env.GOOGLE_MAPS_KEY; else process.env.GOOGLE_MAPS_KEY = saved.m;
    if (saved.g === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = saved.g;
  });
  const without = await s.call("GET", "/api/config/google-maps-key");
  assert.equal(without.status, 404);
  assert.doesNotMatch(without.text, /PAID-GEMINI-KEY/);
  process.env.GOOGLE_MAPS_KEY = "BROWSER-MAPS-KEY";
  const withKey = await s.call("GET", "/api/config/google-maps-key");
  assert.equal(withKey.json.key, "BROWSER-MAPS-KEY");
});
