// server/routes/messages.js
const express = require("express");
const router = express.Router();
const MessageController = require("../controllers/MessageController");

// GET /api/messages - Get all messages (with optional ?recipientId=xxx&senderId=yyy filters)
router.get("/", MessageController.list);

// GET /api/messages/:id - Get a specific message by ID
router.get("/:id", MessageController.getById);

// POST /api/messages - Create a new message
router.post("/", MessageController.create);

module.exports = router;
