// server/routes/logs.js
const express = require("express");
const router = express.Router();
const SyncController = require("../controllers/SyncController");

router.post("/diagnostics", SyncController.receiveDiagnostics);

module.exports = router;
