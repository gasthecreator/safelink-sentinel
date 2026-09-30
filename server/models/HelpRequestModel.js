// server/models/HelpRequestModel.js
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../../data/helpRequests.json");
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ requests: [] }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!data.requests) {
    data.requests = [];
    save(data);
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Simple AI summarization - extracts key help type from message
function summarizeHelpRequest(message) {
  const lowerMessage = message.toLowerCase();
  
  // Medical keywords
  if (lowerMessage.match(/\b(medical|doctor|hospital|injured|wound|bleeding|medicine|medication|health|sick|ill|pain)\b/)) {
    return "Medical Assistance";
  }
  
  // Food/Water keywords
  if (lowerMessage.match(/\b(food|water|hungry|thirsty|starving|drink|eat|meal|supplies)\b/)) {
    return "Food & Water";
  }
  
  // Shelter keywords
  if (lowerMessage.match(/\b(shelter|home|house|place to stay|roof|safe|warm|cold|exposed)\b/)) {
    return "Shelter Needed";
  }
  
  // Transportation keywords
  if (lowerMessage.match(/\b(transport|ride|car|vehicle|stuck|stranded|need to get|cannot move)\b/)) {
    return "Transportation";
  }
  
  // Emergency/Rescue keywords
  if (lowerMessage.match(/\b(emergency|help|rescue|stuck|trapped|danger|urgent|immediate)\b/)) {
    return "Emergency Rescue";
  }
  
  // Communication keywords
  if (lowerMessage.match(/\b(contact|call|phone|communication|message|reach|connect)\b/)) {
    return "Communication";
  }
  
  // Default - extract first few words or key phrase
  const words = message.split(/\s+/).slice(0, 4).join(" ");
  return words.length > 30 ? words.substring(0, 27) + "..." : words;
}

// Analyze message priority - determines if request is critical
function analyzePriority(message) {
  const lowerMessage = message.toLowerCase();
  let criticalScore = 0;
  
  // Critical indicators (high weight)
  const criticalKeywords = [
    /\b(urgent|immediate|asap|emergency|critical|life|death|dying|bleeding|unconscious|can't breathe|can't move|trapped|stuck|danger|dangerous|help now|please help|need help now)\b/gi,
    /\b(heart attack|stroke|seizure|choking|asthma|allergic reaction|overdose|poisoning)\b/gi,
    /\b(fire|flood|earthquake|building collapse|explosion|accident|crash)\b/gi,
  ];
  
  criticalKeywords.forEach((pattern) => {
    const matches = lowerMessage.match(pattern);
    if (matches) {
      criticalScore += matches.length * 3; // High weight for critical keywords
    }
  });
  
  // Moderate indicators (medium weight)
  const moderateKeywords = [
    /\b(injured|hurt|pain|sick|ill|fever|broken|fracture|cut|wound)\b/gi,
    /\b(stranded|stuck|lost|can't find|need to get|trapped)\b/gi,
    /\b(no food|no water|hungry|thirsty|starving|dehydrated)\b/gi,
  ];
  
  moderateKeywords.forEach((pattern) => {
    const matches = lowerMessage.match(pattern);
    if (matches) {
      criticalScore += matches.length * 2; // Medium weight
    }
  });
  
  // Exclamation marks and urgency phrases (low weight but adds up)
  const exclamationCount = (message.match(/!/g) || []).length;
  criticalScore += exclamationCount;
  
  const urgencyPhrases = [
    /\b(as soon as possible|right now|immediately|right away)\b/gi,
    /\b(please|please help|anyone|anybody|someone|somebody)\b/gi,
  ];
  
  urgencyPhrases.forEach((pattern) => {
    const matches = lowerMessage.match(pattern);
    if (matches) {
      criticalScore += matches.length * 1;
    }
  });
  
  // Determine priority level
  if (criticalScore >= 5) {
    return "Critical";
  } else if (criticalScore >= 2) {
    return "High";
  } else {
    return "Normal";
  }
}

module.exports = {
  async add(request) {
    const data = load();
    
    // Generate ID if not provided
    if (!request.id) {
      request.id = `help-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    
    // Ensure timestamp
    if (!request.timestamp) {
      request.timestamp = new Date().toISOString();
    }
    
    // Summarize help nature from message
    if (request.message && !request.natureOfHelp) {
      request.natureOfHelp = summarizeHelpRequest(request.message);
    }
    
    // Analyze priority from message
    if (request.message && !request.priority) {
      request.priority = analyzePriority(request.message);
    }
    
    // Default status
    if (!request.status) {
      request.status = "pending"; // pending, accepted, fulfilled, cancelled
    }
    
    data.requests.push(request);
    save(data);
    console.log("[SafeLink][HelpRequestModel] 📄 Help request added:", request.id);
    return request;
  },

  async all() {
    const data = load();
    return data.requests;
  },

  async getById(id) {
    const data = load();
    return data.requests.find((r) => r.id === id) || null;
  },

  async getPending() {
    const data = load();
    return data.requests.filter((r) => r.status === "pending" || r.status === "accepted");
  },

  async getActive() {
    const data = load();
    // Active requests are those that haven't been fulfilled or cancelled
    return data.requests.filter((r) => r.status !== "fulfilled" && r.status !== "cancelled");
  },

  async getByStatus(status) {
    const data = load();
    return data.requests.filter((r) => r.status === status);
  },

  async updateStatus(id, status) {
    const data = load();
    const request = data.requests.find((r) => r.id === id);
    if (request) {
      request.status = status;
      request.updatedAt = new Date().toISOString();
      save(data);
      return request;
    }
    return null;
  },

  async getRecent(limit = 50) {
    const data = load();
    return data.requests
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  },

  async clear() {
    save({ requests: [] });
    console.log("[SafeLink][HelpRequestModel] 🧹 Cleared all help requests");
    return { success: true };
  },
};

