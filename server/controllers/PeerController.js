// server/controllers/PeerController.js
const PeerModel = require("../models/PeerModel");

async function list(req, res) {
  try {
    const activeOnly = req.query.active === "true";
    const peers = activeOnly 
      ? await PeerModel.getActive() 
      : await PeerModel.getAll();
    
    res.json({
      success: true,
      count: peers.length,
      peers,
    });
  } catch (err) {
    console.error("[SafeLink][PeerController] ❌ List error:", err);
    res.status(500).json({
      error: "Failed to fetch peers",
      message: err.message,
    });
  }
}

async function getById(req, res) {
  try {
    const { id } = req.params;
    const peer = await PeerModel.getById(id);
    
    if (!peer) {
      return res.status(404).json({
        error: "Peer not found",
        message: `No peer found with id: ${id}`,
      });
    }
    
    res.json({
      success: true,
      peer,
    });
  } catch (err) {
    console.error("[SafeLink][PeerController] ❌ Get peer error:", err);
    res.status(500).json({
      error: "Failed to fetch peer",
      message: err.message,
    });
  }
}

async function register(req, res) {
  try {
    const peer = req.body;
    
    // Validate required fields
    if (!peer.id) {
      return res.status(400).json({
        error: "Missing required field: id",
        message: "Peer must include an 'id' field",
      });
    }
    
    const savedPeer = await PeerModel.upsert(peer);
    
    console.log(`[SafeLink][PeerController] ✅ Peer registered/updated: ${savedPeer.id}`);
    
    res.json({
      success: true,
      message: "Peer registered successfully",
      peer: savedPeer,
    });
  } catch (err) {
    console.error("[SafeLink][PeerController] ❌ Register error:", err);
    res.status(500).json({
      error: "Failed to register peer",
      message: err.message,
    });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;
    await PeerModel.remove(id);
    
    res.json({
      success: true,
      message: "Peer removed successfully",
    });
  } catch (err) {
    console.error("[SafeLink][PeerController] ❌ Remove error:", err);
    res.status(500).json({
      error: "Failed to remove peer",
      message: err.message,
    });
  }
}

module.exports = {
  list,
  getById,
  register,
  remove,
};
