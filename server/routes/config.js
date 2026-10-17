// server/routes/config.js

const express = require("express");
const router = express.Router();

// The Maps key the dashboard's shelter map loads in the browser. By nature a browser key is visible to anyone
// who opens the page, so: it must be a key of its own (GOOGLE_MAPS_KEY) restricted in Google Cloud to this
// site's HTTP referrer and to the Maps APIs. GOOGLE_API_KEY is NOT used here: it may be the paid Gemini
// key the server uses, and handing that out would let anyone spend it.
router.get("/google-maps-key", (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_KEY || "";
  
  if (!apiKey) {
    return res.status(404).json({
      error: "API key not configured",
      message: "Google Maps API key not found in environment variables",
    });
  }

  res.json({
    key: apiKey,
    message: "API key retrieved successfully",
  });
});

module.exports = router;

