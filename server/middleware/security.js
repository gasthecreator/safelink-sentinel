// server/middleware/security.js
// Security headers, a strict CORS policy, rate limits, an admin gate and safe error responses.
// No new dependencies: each of these is small enough to read and test here.

const crypto = require("crypto");

// ---- headers -----------------------------------------------------------------------------------

/** Headers for an API that only returns JSON: nothing in a response may be framed, sniffed or run. */
function securityHeaders({ production = false } = {}) {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cache-Control", "no-store");
    res.removeHeader("X-Powered-By");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
  };
}

// ---- CORS --------------------------------------------------------------------------------------

/** The browser origins allowed to call the API, from FRONTEND_URL (comma separated). "*" allows any. */
function allowedOriginsFrom(env = process.env) {
  const configured = (env.FRONTEND_URL || "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (configured.length) return configured;
  // nothing configured: only the local development servers
  return ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"];
}

/**
 * A request with no Origin header is not from a browser page (the phone app, curl, a server): allowed.
 * A browser page from any other origin is not given CORS headers, so the browser refuses to let it read
 * the answer.
 */
function corsOptions(allowed) {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.includes("*") || allowed.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
}

// ---- rate limiting -----------------------------------------------------------------------------

/**
 * A fixed-window limit per client address. In memory, so it is per server process: enough to stop one
 * client hammering a paid or expensive endpoint, not a defence against a large distributed attack.
 */
function rateLimit({ windowMs = 60000, max = 60, name = "default", now = () => Date.now(), keyOf = (req) => req.ip || "unknown" } = {}) {
  const hits = new Map(); // key -> { count, resetAt }
  let lastSweep = now();
  return (req, res, next) => {
    const t = now();
    if (t - lastSweep > windowMs) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      lastSweep = t;
    }
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: "Too many requests", message: `Slow down and try again in ${retry} seconds.`, limit: name });
    }
    return next();
  };
}

// ---- admin gate --------------------------------------------------------------------------------

/**
 * For actions that change or delete other people's data. Needs "Authorization: Bearer <ADMIN_TOKEN>".
 * With no ADMIN_TOKEN configured the action is simply off (503), never open.
 */
function requireAdmin() {
  return (req, res, next) => {
    // the settings the app was built with (createApp stores them), else the process's
    const env = (req.app && req.app.locals && req.app.locals.env) || process.env;
    const expected = env.ADMIN_TOKEN;
    if (!expected || expected.length < 16) {
      return res.status(503).json({ error: "Disabled", message: "This action is turned off on this server." });
    }
    const header = req.get("authorization") || "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "Unauthorized", message: "A valid admin token is needed." });
    }
    return next();
  };
}

// ---- errors ------------------------------------------------------------------------------------

function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

/** Never send an internal error message to a client in production; do say what the client did wrong. */
function errorHandler({ production = false, log = console.error } = {}) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Too large", message: "That request is too big." });
    if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
      return res.status(400).json({ error: "Bad request", message: "The request body is not valid JSON." });
    }
    if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Too large", message: "That file is too big." });
    log("[SafeLink][Server] Unhandled error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "Server error", message: production ? "Something went wrong." : String((err && err.message) || err) });
  };
}

module.exports = { securityHeaders, allowedOriginsFrom, corsOptions, rateLimit, requireAdmin, notFound, errorHandler };
