// app/services/ble/BleProtocol.js
// Wire protocol shared by the BLE central (react-native-ble-plx) and the
// native peripheral modules (Swift CBPeripheralManager / Kotlin GATT server).
//
// GATT layout (peripheral side):
//   Service  SERVICE_UUID
//     MESSAGE_CHAR_UUID   write / write-without-response   (frames in)
//     IDENTITY_CHAR_UUID  read                              (public profile JSON)
//
// A message is far larger than one BLE write, so it is split into frames:
//   byte 0      protocol version (1)
//   bytes 1-2   transfer id (u16 BE), random per message sent
//   bytes 3-4   frame index (u16 BE)
//   bytes 5-6   total frames (u16 BE)
//   bytes 7..   payload slice
// The receiver reassembles per (source, transfer id).

export const SERVICE_UUID = "7b3f6a10-5afe-4e1d-9a2c-5afe11c0de00";
export const MESSAGE_CHAR_UUID = "7b3f6a10-5afe-4e1d-9a2c-5afe11c0de01";
export const IDENTITY_CHAR_UUID = "7b3f6a10-5afe-4e1d-9a2c-5afe11c0de03";

export const PROTOCOL_VERSION = 1;
export const FRAME_HEADER_SIZE = 7;
export const ATT_OVERHEAD = 3; // ATT write opcode + handle
export const DEFAULT_MTU = 23; // BLE minimum until a larger MTU is negotiated
export const MAX_FRAMES = 1024;
export const MAX_MESSAGE_BYTES = 128 * 1024;
export const REASSEMBLY_TIMEOUT_MS = 30000;
// Unfinished transfers held at once. Anyone in range can start transfers they never finish, so
// the number is capped (the oldest are dropped first) instead of growing with whatever arrives.
export const MAX_OPEN_TRANSFERS = 64;
export const MAX_OPEN_PER_SOURCE = 4;

// Control frames share the message characteristic but start with a different version byte, so a phone running
// an older build ignores them (its reassembler drops any frame whose first byte is not 1).
export const CONTROL_VERSION = 2;
export const CONTROL_CHALLENGE = 1;
export const CHALLENGE_BYTES = 16;

/** A "prove you hold the key for your advertised identity" request carrying a fresh random nonce. */
export function encodeChallenge(nonce) {
  if (!nonce || nonce.length !== CHALLENGE_BYTES) throw new Error("A challenge needs a 16-byte nonce");
  const frame = new Uint8Array(2 + CHALLENGE_BYTES);
  frame[0] = CONTROL_VERSION;
  frame[1] = CONTROL_CHALLENGE;
  frame.set(nonce, 2);
  return frame;
}

/** { kind: "challenge", nonce } for a well-formed control frame, otherwise null (including every ordinary frame). */
export function decodeControl(frame) {
  if (!frame || frame[0] !== CONTROL_VERSION) return null;
  if (frame[1] === CONTROL_CHALLENGE && frame.length === 2 + CHALLENGE_BYTES) {
    return { kind: "challenge", nonce: frame.slice(2) };
  }
  return null;
}

export function maxFramePayload(mtu = DEFAULT_MTU) {
  const size = mtu - ATT_OVERHEAD - FRAME_HEADER_SIZE;
  if (size < 1) throw new Error(`MTU ${mtu} too small for framing`);
  return size;
}

export function randomTransferId() {
  return Math.floor(Math.random() * 0x10000);
}

/** Split `bytes` into frames that each fit a write on a link with this MTU. */
export function encodeFrames(bytes, mtu = DEFAULT_MTU, transferId = randomTransferId()) {
  if (bytes.length === 0) throw new Error("Cannot frame an empty message");
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error("Message too large to send");

  const chunk = maxFramePayload(mtu);
  const total = Math.ceil(bytes.length / chunk);
  if (total > MAX_FRAMES) throw new Error("Message needs too many frames for this MTU");

  const frames = [];
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(i * chunk, Math.min(bytes.length, (i + 1) * chunk));
    const frame = new Uint8Array(FRAME_HEADER_SIZE + slice.length);
    frame[0] = PROTOCOL_VERSION;
    frame[1] = (transferId >> 8) & 0xff;
    frame[2] = transferId & 0xff;
    frame[3] = (i >> 8) & 0xff;
    frame[4] = i & 0xff;
    frame[5] = (total >> 8) & 0xff;
    frame[6] = total & 0xff;
    frame.set(slice, FRAME_HEADER_SIZE);
    frames.push(frame);
  }
  return frames;
}

export class Reassembler {
  constructor({ timeoutMs = REASSEMBLY_TIMEOUT_MS, now = () => Date.now() } = {}) {
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.transfers = new Map(); // key -> { total, parts: Map, bytes, startedAt }
  }

  /**
   * Feed one received frame. Returns the full message bytes when the final
   * frame of a transfer arrives, otherwise null. Malformed frames are dropped.
   */
  push(sourceId, frame) {
    this.prune();
    if (!frame || frame.length <= FRAME_HEADER_SIZE || frame[0] !== PROTOCOL_VERSION) {
      return null;
    }
    const transferId = (frame[1] << 8) | frame[2];
    const index = (frame[3] << 8) | frame[4];
    const total = (frame[5] << 8) | frame[6];
    if (total === 0 || total > MAX_FRAMES || index >= total) return null;

    const key = `${sourceId}:${transferId}`;
    let transfer = this.transfers.get(key);
    if (!transfer || transfer.total !== total) {
      transfer = { total, parts: new Map(), bytes: 0, startedAt: this.now(), source: sourceId };
      this.transfers.delete(key); // a restarted transfer goes to the back of the queue
      this.transfers.set(key, transfer);
      this.limitOpenTransfers(sourceId);
    }
    if (transfer.parts.has(index)) return null; // duplicate frame

    const payload = frame.subarray(FRAME_HEADER_SIZE);
    transfer.bytes += payload.length;
    if (transfer.bytes > MAX_MESSAGE_BYTES) {
      this.transfers.delete(key);
      return null;
    }
    transfer.parts.set(index, payload);
    if (transfer.parts.size < total) return null;

    const out = new Uint8Array(transfer.bytes);
    let offset = 0;
    for (let i = 0; i < total; i++) {
      const part = transfer.parts.get(i);
      out.set(part, offset);
      offset += part.length;
    }
    this.transfers.delete(key);
    return out;
  }

  // Map order is oldest first, so the oldest unfinished transfers are the ones dropped.
  limitOpenTransfers(sourceId) {
    let fromSource = 0;
    for (const t of this.transfers.values()) if (t.source === sourceId) fromSource++;
    for (const [key, t] of this.transfers) {
      if (fromSource <= MAX_OPEN_PER_SOURCE) break;
      if (t.source === sourceId) {
        this.transfers.delete(key);
        fromSource--;
      }
    }
    while (this.transfers.size > MAX_OPEN_TRANSFERS) this.transfers.delete(this.transfers.keys().next().value);
  }

  prune() {
    const cutoff = this.now() - this.timeoutMs;
    for (const [key, transfer] of this.transfers) {
      if (transfer.startedAt < cutoff) this.transfers.delete(key);
    }
  }
}
