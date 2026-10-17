// server/controllers/SyncController.js
const LogModel = require("../models/LogModel");
const validators = require("../utils/validators");

module.exports = {
  async receiveDiagnostics(req, res) {
    const checked = validators.diagnostics(req.body);
    if (!checked.ok) return res.status(400).json({ error: checked.error, message: checked.message });
    await LogModel.add(checked.value);
    res.json({ ok: true });
  },
};

