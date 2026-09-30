// app/constants/messageSchema.js

export const MESSAGE_STATUS = {
  PENDING: "pending",
  DELIVERED: "delivered",
  FAILED: "failed",
};

export const PRIORITY_LEVELS = ["critical", "high", "normal", "low"];

export function validateMessage(msg) {
  if (!msg) return false;
  if (!msg.id || !msg.senderId || !msg.receiverId) return false;
  if (typeof msg.data !== "string") return false;
  if (!Object.values(MESSAGE_STATUS).includes(msg.status)) return false;
  return true;
}

