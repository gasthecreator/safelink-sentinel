// server/index.js

const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Ensure data directories exist
const dataDir = path.join(__dirname, "data");
const firstAidImagesDir = path.join(dataDir, "first-aid-images");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`[SafeLink][Server] 📁 Created data directory: ${dataDir}`);
}

if (!fs.existsSync(firstAidImagesDir)) {
  fs.mkdirSync(firstAidImagesDir, { recursive: true });
  console.log(`[SafeLink][Server] 📁 Created first-aid-images directory: ${firstAidImagesDir}`);
}

const DisasterSentinelService = require("./services/DisasterSentinelService");
const { createApp } = require("./app");

const app = createApp();
const PORT = process.env.PORT || 4000;

const FETCH_INTERVAL_MS = 30 * 60 * 1000; // poll GDACS every 30 minutes
const PROCESS_INTERVAL_MS = 5 * 60 * 1000; // re-check user proximity every 5 minutes

app.listen(PORT, () => {
  console.log(`[SafeLink][Server] 🌐 Listening on port ${PORT}`);
  console.log(`[SafeLink][Server] 🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

  if (process.env.ENABLE_SENTINEL_SCHEDULER === "true") {
    DisasterSentinelService.safeUpdateEvents();
    setInterval(DisasterSentinelService.safeUpdateEvents, FETCH_INTERVAL_MS);
    setInterval(DisasterSentinelService.processEventsForUsers, PROCESS_INTERVAL_MS);
  } else {
    console.log(
      "[SafeLink][DisasterSentinel] Scheduler disabled (set ENABLE_SENTINEL_SCHEDULER=true to enable GDACS polling)"
    );
  }
});

