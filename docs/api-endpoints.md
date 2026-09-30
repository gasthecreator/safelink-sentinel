# API Endpoints

## Backend Server

**Base URL:** `http://localhost:4000`

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "ts": "2025-11-07T21:00:00.000Z"
}
```

---

### Messages

#### List Messages
```
GET /messages
```

**Response:**
```json
{
  "messages": [...],
  "count": 10
}
```

#### Create Message
```
POST /messages
```

**Body:**
```json
{
  "senderId": "device-123",
  "receiverId": "device-456",
  "content": "Message content",
  "priority": "high"
}
```

---

### Peers

#### List Peers
```
GET /peers
```

**Response:**
```json
{
  "peers": [...],
  "count": 5
}
```

---

### Logs

#### Send Diagnostics
```
POST /logs/diagnostics
```

**Body:**
```json
{
  "peers": 5,
  "messages": 142,
  "successRate": 94.2,
  "avgLatency": 245
}
```

---

## Mobile App API

The mobile app uses these modules to connect to backend:

- `app/api/health.js` - fetchHealth()
- `app/api/sync.js` - pushDiagnostics()
- `app/api/config.js` - API_CONFIG

