#!/usr/bin/env node
// Starts the API server and the web dashboard together, on macOS, Linux and Windows.
//   npm run dev
// Ctrl+C stops both. Ports: server 4000, dashboard 5173 (see README).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const services = [
  { name: "server   ", args: ["start", "-w", "server"] },
  { name: "dashboard", args: ["run", "dev", "-w", "safelink-dashboard"] },
];

const children = services.map(({ name, args }) => {
  const child = spawn(npm, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const prefix = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) out.write(`[${name}] ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] exited (${signal || code}); stopping the other service`);
      stop(code || 1);
    }
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
