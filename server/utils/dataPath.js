// server/utils/dataPath.js
// Where the JSON data files live. Existing deployments keep their current locations; setting
// SAFELINK_DATA_DIR puts every file in one directory (used by the tests, and handy on a host with a
// persistent disk mounted somewhere specific).

const path = require("path");

function dataFile(name, defaultDir) {
  const override = process.env.SAFELINK_DATA_DIR;
  return override ? path.join(path.resolve(override), name) : path.join(defaultDir, name);
}

module.exports = { dataFile };
