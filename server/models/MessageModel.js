// server/models/MessageModel.js
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(process.cwd(), "data", "messages.json");
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ messages: [] }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!data.messages) {
    data.messages = [];
    save(data);
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  async getAll() {
    const data = load();
    return data.messages;
  },

  async getById(id) {
    const data = load();
    return data.messages.find((m) => m.id === id) || null;
  },

  async add(msg) {
    const data = load();
    
    // Ensure message has required fields
    if (!msg.id) {
      msg.id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    
    if (!msg.timestamp) {
      msg.timestamp = new Date().toISOString();
    }
    
    if (!msg.storedAt) {
      msg.storedAt = new Date().toISOString();
    }
    
    data.messages.push(msg);
    save(data);
    console.log("[SafeLink][MessageModel] 📄 Message added:", msg.id);
    return msg;
  },

  async getByRecipient(recipientId) {
    const data = load();
    return data.messages.filter((m) => m.recipientId === recipientId);
  },

  async getBySender(senderId) {
    const data = load();
    return data.messages.filter((m) => m.senderId === senderId);
  },

  async getConversation(peerId1, peerId2) {
    const data = load();
    return data.messages.filter(
      (m) =>
        (m.senderId === peerId1 && m.recipientId === peerId2) ||
        (m.senderId === peerId2 && m.recipientId === peerId1)
    );
  },
};
