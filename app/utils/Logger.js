// app/utils/Logger.js

let fs;
try {
  fs = require("fs");
} catch {
  fs = null;
}

const LOG_FILE = "SafeLink_Core.log";

class Logger {
  log(level, message, meta = null) {
    const ts = new Date().toISOString();
    const line =
      `[${ts}] [${level.toUpperCase()}] ${message}` +
      (meta ? ` | ${JSON.stringify(meta)}` : "");

    console.log(line);

    if (fs && fs.appendFileSync) {
      try {
        fs.appendFileSync(LOG_FILE, line + "\n");
      } catch {
        // ignore file errors in mobile
      }
    }
  }

  info(msg, meta) { this.log("info", msg, meta); }
  warn(msg, meta) { this.log("warn", msg, meta); }
  error(msg, meta) { this.log("error", msg, meta); }
}

export default new Logger();

