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

## Endpoint index

Every route the server mounts (`server/app.js`). "Admin" routes need the `ADMIN_TOKEN` (see [SECURITY.md](SECURITY.md));
"costly" routes call paid or rate-limited upstream services and are rate-limited per client. Request and response
shapes are validated in `server/utils/validators.js`; the sections below document the main ones in detail.

| Method and path | Notes |
|---|---|
| `GET /health` | liveness check |
| `GET /api/messages`, `GET /api/messages/:id`, `POST /api/messages` | mesh messages |
| `GET /api/peers`, `GET /api/peers/:id`, `POST /api/peers` | peer registry |
| `DELETE /api/peers/:id` | admin |
| `POST /api/help-requests`, `GET /api/help-requests`, `GET /api/help-requests/pending`, `GET /api/help-requests/active`, `GET /api/help-requests/:id`, `PATCH /api/help-requests/:id/status` | help requests |
| `POST /api/rescues`, `GET /api/rescues`, `GET /api/rescues/stats`, `GET /api/rescues/:id` | rescue log |
| `DELETE /api/rescues` | admin: erases every record |
| `POST /api/first-aid` | costly: first-aid instructions |
| `POST /api/medai/process_text`, `POST /api/medai/process_audio` | costly: route recommendation from text or audio |
| `GET /api/routes`, `GET /api/routes/find-shelters` | costly: route to a hospital, police station or shelter |
| `GET /api/location-updates`, `POST /api/location-updates`, `GET /api/location-updates/nearby` | location updates |
| `GET /api/weather/alerts`, `GET /api/weather/current` | costly |
| `GET /api/config/google-maps-key` | rate-limited; the key is public to every browser, so restrict it in Google Cloud |
| `POST /api/sentinel/subscribe`, `GET /api/sentinel/alerts`, `GET /api/sentinel/alerts/history`, `GET /api/sentinel/health` | disaster-alert feed |
| `POST /api/sentinel/alerts/push`, `GET /api/sentinel/test-process` | admin |
| `POST /api/logs/diagnostics` | diagnostics upload from the phone app |

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
