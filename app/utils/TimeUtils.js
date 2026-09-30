// app/utils/TimeUtils.js

export function nowISO() {
  return new Date().toISOString();
}

export function timestamp() {
  return Date.now();
}

export function formatTimestamp(ts) {
  return new Date(ts).toLocaleString();
}

export function timeAgo(timestamp) {
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

export function isExpired(timestamp, ttlHours = 24) {
  const now = Date.now();
  const created = new Date(timestamp).getTime();
  const age = (now - created) / (1000 * 60 * 60); // hours
  return age > ttlHours;
}

