// server/routes/rescues.js
const express = require("express");
const router = express.Router();
const RescueController = require("../controllers/RescueController");

// POST /api/rescues - Log a new rescue event
router.post("/", RescueController.logRescueEvent);

// GET /api/rescues - Get all rescue events (with optional filters)
// Query params: ?limit=100&type=ACCEPT&alertId=alert-123
router.get("/", RescueController.getAllRescues);

// GET /api/rescues/stats - Get aggregate statistics
router.get("/stats", RescueController.getRescueStats);

// GET /api/rescues/:id - Get a specific rescue by ID
router.get("/:id", RescueController.getRescueById);

// DELETE /api/rescues - Clear all rescue logs (use with caution)
router.delete("/", RescueController.clearRescues);

module.exports = router;

