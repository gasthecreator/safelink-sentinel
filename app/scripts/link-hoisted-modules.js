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
//
// WARNING: if these symlinks already exist when `npm install` runs, npm sees
// them as extraneous and deletes the *hoisted packages they point at* (the
// repo-root node_modules/@react-native* directories end up empty). Remove the
// symlinks before installing, and this script will recreate them afterwards:
//
//   rm app/node_modules/react-native app/node_modules/@react-native \
//      app/node_modules/@react-native-community && npm install

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
