// server/controllers/RescueController.js
const RescueModel = require("../models/RescueModel");

async function logRescueEvent(req, res) {
  try {
    const rescue = req.body;

    // Validate required fields
    if (!rescue.type) {
      return res.status(400).json({
        error: "Missing required field: type",
        message: "Rescue event must include 'type' field (ACCEPT or ARRIVED)",
      });
    }

    if (!rescue.alertId) {
      return res.status(400).json({
        error: "Missing required field: alertId",
        message: "Rescue event must include 'alertId' field",
      });
    }

    // Ensure timestamp
    if (!rescue.timestamp) {
      rescue.timestamp = new Date().toISOString();
    }

    const savedRescue = await RescueModel.add(rescue);

    console.log(
      `[SafeLink][RescueController] ✅ Rescue event logged: ${savedRescue.type} for alert ${savedRescue.alertId}`
    );

    res.status(201).json({
      success: true,
      message: "Rescue event logged successfully",
      rescue: savedRescue,
    });
  } catch (err) {
    console.error("[SafeLink][RescueController] ❌ Rescue log error:", err);
    res.status(500).json({
      error: "Failed to log rescue event",
      message: err.message,
    });
  }
}

async function getRescueStats(req, res) {
  try {
    const stats = await RescueModel.stats();
    res.json(stats);
  } catch (err) {
    console.error("[SafeLink][RescueController] ❌ Stats error:", err);
    res.status(500).json({
      error: "Failed to load rescue stats",
      message: err.message,
    });
  }
}

async function getAllRescues(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type; // Optional filter by type
    const alertId = req.query.alertId; // Optional filter by alertId

    let rescues;

    if (alertId) {
      rescues = await RescueModel.getByAlertId(alertId);
    } else if (type) {
      rescues = await RescueModel.getByType(type);
    } else {
      rescues = await RescueModel.getRecent(limit);
    }

    res.json({
      success: true,
      count: rescues.length,
      rescues,
    });
  } catch (err) {
    console.error("[SafeLink][RescueController] ❌ Get rescues error:", err);
    res.status(500).json({
      error: "Failed to fetch rescues",
      message: err.message,
    });
  }
}

async function getRescueById(req, res) {
  try {
    const { id } = req.params;
    const rescue = await RescueModel.getById(id);

    if (!rescue) {
      return res.status(404).json({
        error: "Rescue not found",
        message: `No rescue event found with id: ${id}`,
      });
    }

    res.json({
      success: true,
      rescue,
    });
  } catch (err) {
    console.error("[SafeLink][RescueController] ❌ Get rescue error:", err);
    res.status(500).json({
      error: "Failed to fetch rescue",
      message: err.message,
    });
  }
}

async function clearRescues(req, res) {
  try {
    await RescueModel.clear();
    res.json({
      success: true,
      message: "All rescue logs cleared",
    });
  } catch (err) {
    console.error("[SafeLink][RescueController] ❌ Clear error:", err);
    res.status(500).json({
      error: "Failed to clear rescue logs",
      message: err.message,
    });
  }
}

module.exports = {
  logRescueEvent,
  getRescueStats,
  getAllRescues,
  getRescueById,
  clearRescues,
};

