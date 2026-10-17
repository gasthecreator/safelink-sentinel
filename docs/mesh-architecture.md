# SafeLink Mesh AI - Architecture

## System Overview

SafeLink Mesh AI is an offline-first mesh networking system for emergency communications.

## Architecture Layers

### 1. **Presentation Layer** (React Native)
- UI Components
- Screens
- Navigation

### 2. **Business Logic Layer**
- Hooks (React state management)
- Services (Core functionality)

### 3. **Data Layer**
- Storage (SQLite, AsyncStorage)
- Models (Data persistence)

### 4. **Network Layer**
- Mesh networking (BLE is the primary, tested-in-design path; WiFi-P2P is optional and has not been exercised on real devices)
- Message routing
- Peer discovery

### 5. **AI Layer**
- RouterAI - picks the next-hop peer with a heuristic score (a placeholder for a trained model)
- PriorityClassifier - keyword heuristics for message urgency

### 6. **Security Layer**
- Ed25519 signatures on every message (TweetNaCl)
- Direct messages sealed to the recipient with NaCl box (X25519 + XSalsa20-Poly1305); broadcast alerts are signed, not secret
- Identity management, with private keys in the iOS Keychain / Android Keystore
- See [SECURITY.md](SECURITY.md) for what is and is not protected

## Key Components

### MeshManager
Central coordinator for all mesh operations.

### NodeDiscovery
Discovers nearby peers using BLE (and optionally WiFi-P2P).

### MessageRelay
Handles message creation, encryption, signing, and delivery.

### GeoBroadcast
Geo-fenced broadcasting for emergency alerts.

### RouterAI
Learns peer reliability and selects optimal routes.

### AlertManager
Auto-triggered and manual emergency alerts.

## Data Flow

1. User creates message
2. Message is encrypted and signed
3. Priority is classified
4. Best route is determined by AI
5. Message is sent to peer
6. Delivery outcome is logged
7. AI learns from outcome

## Offline Capability

- Messages queued locally
- Store-and-forward routing
- Automatic retry logic
- Sync when connectivity restored

