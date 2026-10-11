// app/scripts/link-hoisted-modules.js
//
// This repo uses npm workspaces, which hoists most React Native packages to
// the repo-root node_modules instead of app/node_modules. Metro's resolver
// walks up directories and finds them fine, but the Android Gradle build
// (settings.gradle, app/build.gradle) and the iOS "Bundle React Native code
// and images" build phase reference them with paths relative to app/ (e.g.
// "../node_modules/react-native"), which only resolves inside app/node_modules.
//
// npm install only hoists hoistable deps and removes/skips the rest, so these
// symlinks keep getting pruned on every `npm install`. Recreate them here as
// a postinstall step instead of fixing it by hand each time.

const fs = require("fs");
const path = require("path");

const appNodeModules = path.join(__dirname, "..", "node_modules");
const rootNodeModules = path.join(__dirname, "..", "..", "node_modules");

const links = ["react-native", "@react-native", "@react-native-community"];

for (const name of links) {
  const target = path.join(rootNodeModules, name);
  const linkPath = path.join(appNodeModules, name);

  if (!fs.existsSync(target)) {
    continue; // not hoisted to root (or not installed) - nothing to link
  }

  const relativeTarget = path.relative(path.dirname(linkPath), target);

  try {
    const existing = fs.lstatSync(linkPath);
    if (existing.isSymbolicLink() && fs.readlinkSync(linkPath) === relativeTarget) {
      continue; // already correct
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // doesn't exist yet - fine
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(relativeTarget, linkPath);
  console.log(`[link-hoisted-modules] linked ${name} -> ${relativeTarget}`);
}
