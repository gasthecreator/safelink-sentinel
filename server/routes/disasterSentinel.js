// server/routes/disasterSentinel.js
const express = require("express");
const router = express.Router();
const DisasterSentinelController = require("../controllers/DisasterSentinelController");
const { requireAdmin } = require("../middleware/security");

router.post("/subscribe", DisasterSentinelController.subscribeUser);
router.get("/alerts", DisasterSentinelController.getAlerts);
router.get("/alerts/history", DisasterSentinelController.getAlertHistory);
router.post("/alerts/push", requireAdmin(), DisasterSentinelController.pushNotification); // sends an alert as the system: admin only
router.get("/test-process", requireAdmin(), DisasterSentinelController.manualProcess); // triggers outside polling: admin only
router.get("/health", DisasterSentinelController.healthCheck);

module.exports = router;
