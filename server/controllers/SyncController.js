// server/controllers/SyncController.js
const LogModel = require("../models/LogModel");

module.exports = {
  async receiveDiagnostics(req, res) {
    const report = req.body;
    await LogModel.add(report);
    res.json({ ok: true });
  },
};

