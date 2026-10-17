// server/utils/atomicFile.js
// Write a JSON file so that a crash or a second request in the middle of a write can never leave a
// half-written (and therefore unreadable, so lost) file: write beside it, then rename over it.

const fs = require("fs");
const path = require("path");

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { writeJsonAtomic };
