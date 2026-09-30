// server/models/PeerModel.js
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(process.cwd(), "data", "peers.json");
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ peers: [] }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!data.peers) {
    data.peers = [];
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
    return data.peers;
  },

  async getById(id) {
    const data = load();
    return data.peers.find((p) => p.id === id) || null;
  },

  async upsert(peer) {
    const data = load();
    const idx = data.peers.findIndex((p) => p.id === peer.id);
    
    // Ensure required fields
    if (!peer.lastSeen) {
      peer.lastSeen = new Date().toISOString();
    }
    if (!peer.firstSeen) {
      peer.firstSeen = new Date().toISOString();
    }
    
    if (idx === -1) {
      data.peers.push(peer);
    } else {
      // Update last seen
      data.peers[idx] = { ...data.peers[idx], ...peer, lastSeen: new Date().toISOString() };
    }
    save(data);
    return data.peers[idx] || peer;
  },

  async remove(id) {
    const data = load();
    data.peers = data.peers.filter((p) => p.id !== id);
    save(data);
    return true;
  },

  async getActive(maxAgeMinutes = 5) {
    const data = load();
    const now = new Date();
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    return data.peers.filter((peer) => {
      if (!peer.lastSeen) return false;
      const lastSeen = new Date(peer.lastSeen);
      return (now - lastSeen) < maxAge;
    });
  },
};
