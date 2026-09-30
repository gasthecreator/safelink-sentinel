// server/routes/peers.js
const express = require("express");
const router = express.Router();
const PeerController = require("../controllers/PeerController");

// GET /api/peers - Get all peers (with optional ?active=true filter)
router.get("/", PeerController.list);

// GET /api/peers/:id - Get a specific peer by ID
router.get("/:id", PeerController.getById);

// POST /api/peers - Register or update a peer
router.post("/", PeerController.register);

// DELETE /api/peers/:id - Remove a peer
router.delete("/:id", PeerController.remove);

module.exports = router;
