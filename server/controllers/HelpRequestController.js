// server/controllers/HelpRequestController.js
const HelpRequestModel = require("../models/HelpRequestModel");
const validators = require("../utils/validators");
const v = require("../utils/validate");

async function createHelpRequest(req, res) {
  try {
    const checked = validators.helpRequest(req.body);
    if (!checked.ok) return res.status(400).json({ error: checked.error, message: checked.message });

    const savedRequest = await HelpRequestModel.add(checked.value);

    console.log(
      `[SafeLink][HelpRequestController] ✅ Help request created: ${savedRequest.id} - ${savedRequest.natureOfHelp}`
    );

    res.status(201).json({
      success: true,
      message: "Help request created successfully",
      request: savedRequest,
    });
  } catch (err) {
    console.error("[SafeLink][HelpRequestController] ❌ Create error:", err);
    res.status(500).json({
      error: "Failed to create help request",
      message: err.message,
    });
  }
}

async function getAllHelpRequests(req, res) {
  try {
    const status = v.oneOf(req.query.status, validators.HELP_STATUSES); // Optional filter by status
    const limit = v.limit(req.query.limit, 100, 500);

    let requests;

    if (status) {
      requests = await HelpRequestModel.getByStatus(status);
    } else {
      requests = await HelpRequestModel.getRecent(limit);
    }

    res.json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (err) {
    console.error("[SafeLink][HelpRequestController] ❌ Get requests error:", err);
    res.status(500).json({
      error: "Failed to fetch help requests",
      message: err.message,
    });
  }
}

async function getPendingRequests(req, res) {
  try {
    const requests = await HelpRequestModel.getPending();
    res.json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (err) {
    console.error("[SafeLink][HelpRequestController] ❌ Get pending error:", err);
    res.status(500).json({
      error: "Failed to fetch pending requests",
      message: err.message,
    });
  }
}

async function getActiveRequests(req, res) {
  try {
    const requests = await HelpRequestModel.getActive();
    res.json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (err) {
    console.error("[SafeLink][HelpRequestController] ❌ Get active error:", err);
    res.status(500).json({
      error: "Failed to fetch active requests",
      message: err.message,
    });
  }
}

async function getHelpRequestById(req, res) {
  try {
    const { id } = req.params;
    const request = await HelpRequestModel.getById(id);

    if (!request) {
      return res.status(404).json({
        error: "Help request not found",
        message: `No help request found with id: ${id}`,
      });
    }

    res.json({
      success: true,
      request,
    });
  } catch (err) {
    console.error("[SafeLink][HelpRequestController] ❌ Get request error:", err);
    res.status(500).json({
      error: "Failed to fetch help request",
      message: err.message,
    });
  }
}

async function updateRequestStatus(req, res) {
  try {
    const { id } = req.params;
    const checked = validators.helpStatus(req.body);
    if (!checked.ok) return res.status(400).json({ error: checked.error, message: checked.message });
    const status = checked.value;

    const request = await HelpRequestModel.updateStatus(id, status);

    if (!request) {
      return res.status(404).json({
        error: "Help request not found",
        message: `No help request found with id: ${id}`,
      });
    }

    res.json({
      success: true,
      message: "Help request status updated",
      request,
    });
  } catch (err) {
    console.error("[SafeLink][HelpRequestController] ❌ Update status error:", err);
    res.status(500).json({
      error: "Failed to update help request status",
      message: err.message,
    });
  }
}

module.exports = {
  createHelpRequest,
  getAllHelpRequests,
  getPendingRequests,
  getActiveRequests,
  getHelpRequestById,
  updateRequestStatus,
};

