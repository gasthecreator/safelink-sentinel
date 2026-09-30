// server/routes/helpRequests.js
const express = require("express");
const router = express.Router();
const HelpRequestController = require("../controllers/HelpRequestController");

// POST /api/help-requests - Create a new help request
router.post("/", HelpRequestController.createHelpRequest);

// GET /api/help-requests - Get all help requests (with optional filters)
// Query params: ?limit=100&status=pending
router.get("/", HelpRequestController.getAllHelpRequests);

// GET /api/help-requests/pending - Get all pending help requests
router.get("/pending", HelpRequestController.getPendingRequests);

// GET /api/help-requests/active - Get all active (non-fulfilled) help requests
router.get("/active", HelpRequestController.getActiveRequests);

// GET /api/help-requests/:id - Get a specific help request by ID
router.get("/:id", HelpRequestController.getHelpRequestById);

// PATCH /api/help-requests/:id/status - Update help request status
router.patch("/:id/status", HelpRequestController.updateRequestStatus);

module.exports = router;

