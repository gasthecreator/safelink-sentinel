// server/routes/firstAid.js

const express = require("express");
const router = express.Router();
const FirstAidController = require("../controllers/FirstAidController");

// POST /api/first-aid - Get first aid instructions based on description
router.post("/", FirstAidController.getFirstAidInstructions);

module.exports = router;

