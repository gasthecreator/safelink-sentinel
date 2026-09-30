// server/controllers/MessageController.js
const MessageModel = require("../models/MessageModel");
const PeerModel = require("../models/PeerModel");

async function list(req, res) {
  try {
    const recipientId = req.query.recipientId;
    const senderId = req.query.senderId;
    
    let messages = await MessageModel.getAll();
    
    // Filter by recipient if provided
    if (recipientId) {
      messages = messages.filter((msg) => msg.recipientId === recipientId);
    }
    
    // Filter by sender if provided
    if (senderId) {
      messages = messages.filter((msg) => msg.senderId === senderId);
    }
    
    // Sort by timestamp (newest first)
    messages.sort((a, b) => {
      const timeA = new Date(a.timestamp || a.storedAt || 0);
      const timeB = new Date(b.timestamp || b.storedAt || 0);
      return timeB - timeA;
    });
    
    res.json({
      success: true,
      count: messages.length,
      messages,
    });
  } catch (err) {
    console.error("[SafeLink][MessageController] ❌ List error:", err);
    res.status(500).json({
      error: "Failed to fetch messages",
      message: err.message,
    });
  }
}

async function create(req, res) {
  try {
    const msg = req.body;
    
    // Validate required fields
    if (!msg.content) {
      return res.status(400).json({
        error: "Missing required field: content",
        message: "Message must include 'content' field",
      });
    }
    
    if (!msg.senderId) {
      return res.status(400).json({
        error: "Missing required field: senderId",
        message: "Message must include 'senderId' field",
      });
    }
    
    // Ensure timestamp
    if (!msg.timestamp) {
      msg.timestamp = new Date().toISOString();
    }
    
    // Ensure message ID
    if (!msg.id) {
      msg.id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    
    // If recipientId is provided, verify peer exists
    if (msg.recipientId) {
      const recipient = await PeerModel.getById(msg.recipientId);
      if (!recipient) {
        return res.status(404).json({
          error: "Recipient not found",
          message: `No peer found with id: ${msg.recipientId}`,
        });
      }
    }
    
    const saved = await MessageModel.add(msg);
    
    console.log(
      `[SafeLink][MessageController] ✅ Message created: ${saved.id} from ${saved.senderId}${saved.recipientId ? ` to ${saved.recipientId}` : ""}`
    );
    
    res.status(201).json({
      success: true,
      message: saved,
    });
  } catch (err) {
    console.error("[SafeLink][MessageController] ❌ Create error:", err);
    res.status(500).json({
      error: "Failed to create message",
      message: err.message,
    });
  }
}

async function getById(req, res) {
  try {
    const { id } = req.params;
    const messages = await MessageModel.getAll();
    const message = messages.find((m) => m.id === id);
    
    if (!message) {
      return res.status(404).json({
        error: "Message not found",
        message: `No message found with id: ${id}`,
      });
    }
    
    res.json({
      success: true,
      message,
    });
  } catch (err) {
    console.error("[SafeLink][MessageController] ❌ Get message error:", err);
    res.status(500).json({
      error: "Failed to fetch message",
      message: err.message,
    });
  }
}

module.exports = {
  list,
  create,
  getById,
};
