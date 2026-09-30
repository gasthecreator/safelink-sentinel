// server/controllers/DisasterSentinelController.js
const DisasterSentinelModel = require("../models/DisasterSentinelModel");
const DisasterSentinelService = require("../services/DisasterSentinelService");

async function subscribeUser(req, res) {
  try {
    const { user_id: userId, name, lat: bodyLat, lon: bodyLon } = req.body;

    if (!userId || !name) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Both 'user_id' and 'name' are required",
      });
    }

    let lat = bodyLat;
    let lon = bodyLon;

    if (lat == null || lon == null) {
      const clientIp = req.ip;
      const location = clientIp ? await DisasterSentinelService.getUserLocationFromIp(clientIp) : null;

      if (location) {
        if (lat == null) lat = location.lat;
        if (lon == null) lon = location.lon;
      } else {
        if (lat == null) {
          lat = DisasterSentinelService.DEFAULT_LAT;
          console.log(
            `[SafeLink][DisasterSentinel] Using default latitude for user ${userId} (IP detection failed or unavailable)`
          );
        }
        if (lon == null) lon = DisasterSentinelService.DEFAULT_LON;
      }
    }

    const user = {
      user_id: userId,
      name,
      lat,
      lon,
      subscribed_on: new Date().toISOString(),
    };
    await DisasterSentinelModel.saveUser(userId, user);

    res.status(201).json({ message: "user subscribed", user });
  } catch (err) {
    console.error("[SafeLink][DisasterSentinelController] Subscribe error:", err.message);
    res.status(500).json({ error: "Failed to subscribe user", message: err.message });
  }
}

async function getAlerts(req, res) {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit)) limit = 20;
    if (limit <= 0) return res.json([]);
    if (limit > 1000) limit = 1000;

    const alerts = await DisasterSentinelModel.getAlerts();
    res.json(alerts.slice(-limit));
  } catch (err) {
    console.error("[SafeLink][DisasterSentinelController] Get alerts error:", err.message);
    res.status(500).json({ error: "Failed to fetch alerts", message: err.message });
  }
}

async function getAlertHistory(req, res) {
  try {
    const { user_id: userId } = req.query;
    const alerts = await DisasterSentinelModel.getAlerts();

    if (userId) {
      const filtered = alerts.filter((a) => a.user_id === userId);
      return res.json({ user_id: userId, count: filtered.length, alerts: filtered });
    }

    res.json({ count: alerts.length, alerts });
  } catch (err) {
    console.error("[SafeLink][DisasterSentinelController] Alert history error:", err.message);
    res.status(500).json({ error: "Failed to fetch alert history", message: err.message });
  }
}

async function pushNotification(req, res) {
  try {
    const { user_id: userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Both 'user_id' and 'message' are required",
      });
    }

    const user = await DisasterSentinelModel.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found", message: `User ${userId} not found` });
    }

    const alertPayload = {
      user_id: userId,
      user_name: user.name || userId,
      disaster_type: "Manual",
      risk_level: "Unknown",
      alert_level: "Warning",
      proximity_level: DisasterSentinelService.classifyProximity("Unknown"),
      coords: [user.lat || 0, user.lon || 0],
      severity: "unknown",
      event_id: "manual",
      message,
      timestamp: new Date().toISOString(),
    };

    await DisasterSentinelModel.addAlert(alertPayload);
    console.log(`[SafeLink][DisasterSentinel] Notification sent to ${user.name || userId}: ${message}`);

    res.json({ message: "Notification sent", alert: alertPayload });
  } catch (err) {
    console.error("[SafeLink][DisasterSentinelController] Push notification error:", err.message);
    res.status(500).json({ error: "Failed to push notification", message: err.message });
  }
}

async function manualProcess(req, res) {
  try {
    await DisasterSentinelService.safeUpdateEvents();
    await DisasterSentinelService.processEventsForUsers();
    const alerts = await DisasterSentinelModel.getAlerts();
    res.json({ message: "processed", alerts: alerts.slice(-10) });
  } catch (err) {
    console.error("[SafeLink][DisasterSentinelController] Manual process error:", err.message);
    res.status(500).json({ error: "Failed to process events", message: err.message });
  }
}

async function healthCheck(req, res) {
  try {
    const cache = await DisasterSentinelModel.getCache();
    const users = await DisasterSentinelModel.getUsers();
    const alerts = await DisasterSentinelModel.getAlerts();

    res.json({
      status: "ok",
      last_update: cache.last_update,
      user_count: Object.keys(users).length,
      alerts_count: alerts.length,
      cached_events: (cache.events || []).length,
      offline_mode: (cache.consecutive_failures || 0) > 1,
    });
  } catch (err) {
    console.error("[SafeLink][DisasterSentinelController] Health check error:", err.message);
    res.status(500).json({ error: "Failed health check", message: err.message });
  }
}

module.exports = {
  subscribeUser,
  getAlerts,
  getAlertHistory,
  pushNotification,
  manualProcess,
  healthCheck,
};
