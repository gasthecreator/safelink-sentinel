#!/usr/bin/env node
// Checks Prettier formatting on the JavaScript files that changed against a base branch.
//   npm run format:changed            compares with origin/main
//   npm run format:changed -- main    compares with another base
//   npm run format:changed -- --write fixes them
// Only changed files are checked: the code base predates Prettier, so a whole-repo check would fail on
// nearly everything. Files become formatted as they are touched.
import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const write = args.includes("--write");
const base = args.find((a) => !a.startsWith("--")) || "origin/main";

const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(js|jsx|cjs|mjs)$/.test(f))
  .filter((f) => !/^(app\/android|app\/ios)\//.test(f) && !f.endsWith(".bundle"));

if (changed.length === 0) {
  console.log(`No changed JavaScript files against ${base}.`);
  process.exit(0);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["prettier", write ? "--write" : "--check", ...changed], { stdio: "inherit" });
process.exit(result.status ?? 1);
