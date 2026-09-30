// server/routes/disasterSentinel.js
const express = require("express");
const router = express.Router();
const DisasterSentinelController = require("../controllers/DisasterSentinelController");

router.post("/subscribe", DisasterSentinelController.subscribeUser);
router.get("/alerts", DisasterSentinelController.getAlerts);
router.get("/alerts/history", DisasterSentinelController.getAlertHistory);
router.post("/alerts/push", DisasterSentinelController.pushNotification);
router.get("/test-process", DisasterSentinelController.manualProcess);
router.get("/health", DisasterSentinelController.healthCheck);

module.exports = router;
