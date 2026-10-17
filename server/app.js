// server/app.js
// The Express app, built by a function so tests can run it on their own port with their own settings.

const express = require("express");
const cors = require("cors");
const {
  securityHeaders, allowedOriginsFrom, corsOptions, rateLimit, notFound, errorHandler,
} = require("./middleware/security");

function createApp(env = process.env) {
  const production = env.NODE_ENV === "production";
  const app = express();
  app.locals.env = env;

  // How many proxies sit in front of the server (Render has one). Trusting more than that would let a
  // client choose its own address with X-Forwarded-For and walk around the rate limits.
  const trust = env.TRUST_PROXY !== undefined ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : production ? 1 : false;
  app.set("trust proxy", trust);
  app.disable("x-powered-by");

  app.use(securityHeaders({ production }));
  const allowed = allowedOriginsFrom(env);
  app.use(cors(corsOptions(allowed)));

  // Limits: everything, then writes, then the endpoints that call paid or external services.
  const limits = {
    everything: rateLimit({ name: "all", windowMs: 60000, max: Number(env.RATE_LIMIT_PER_MINUTE) || 300 }),
    writes: rateLimit({ name: "writes", windowMs: 60000, max: 40 }),
    costly: rateLimit({ name: "costly", windowMs: 60000, max: 12 }),
    key: rateLimit({ name: "key", windowMs: 60000, max: 6 }),
  };
  app.get("/health", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));
  app.use(limits.everything);
  app.use((req, res, next) => (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? limits.writes(req, res, next) : next()));

  // Bodies are small JSON: anything bigger is refused before it is parsed.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.use("/api/messages", require("./routes/messages"));
  app.use("/api/peers", require("./routes/peers"));
  app.use("/logs", require("./routes/logs"));
  app.use("/api/rescues", require("./routes/rescues"));
  app.use("/api/help-requests", require("./routes/helpRequests"));
  app.use("/api/first-aid", limits.costly, require("./routes/firstAid"));
  app.use("/api/medai", limits.costly, require("./routes/medai"));
  app.use("/api/routes", limits.costly, require("./routes/routes"));
  app.use("/api/location-updates", require("./routes/locationUpdates"));
  app.use("/api/weather", limits.costly, require("./routes/weather"));
  app.use("/api/config", limits.key, require("./routes/config"));
  app.use("/api/sentinel", require("./routes/disasterSentinel"));

  app.use(notFound);
  app.use(errorHandler({ production }));
  return app;
}

module.exports = { createApp };
