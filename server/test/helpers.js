const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

/** Start the real app on a random port with its own data directory and settings. Returns { url, close, dir, call }. */
async function startServer(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safelink-test-"));
  process.env.SAFELINK_DATA_DIR = dir;
  // fresh copies of every module, so they see this data directory
  for (const key of Object.keys(require.cache)) if (!key.includes("node_modules")) delete require.cache[key];
  const env = { NODE_ENV: "test", FRONTEND_URL: "https://dash.example", ...extraEnv };
  const { createApp } = require("../app");
  const app = createApp(env);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, headers = {}, raw } = {}) => {
    const res = await fetch(url + p, {
      method,
      headers: { ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, json, text };
  };
  return {
    url, dir, call,
    // closeAllConnections: do not wait for the client's idle keep-alive connections (a failed test must not hang the run)
    close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }),
  };
}

module.exports = { startServer };
