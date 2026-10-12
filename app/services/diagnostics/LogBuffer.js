// app/services/diagnostics/LogBuffer.js
// Keeps the most recent console output in memory so it can be viewed and shared
// from the Diagnostics screen. Release builds on iOS show no console at all, so
// without this a failed device test leaves nothing to look at.

const MAX_ENTRIES = 800;
const MAX_LINE = 700;
const LEVELS = ["log", "info", "warn", "error"];

let entries = [];
let listeners = [];
let installed = false;

function safeString(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(level, args) {
  let message = args.map(safeString).join(" ");
  if (message.length > MAX_LINE) message = `${message.slice(0, MAX_LINE)}…`;
  entries.push({ time: Date.now(), level, message });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  listeners.forEach((cb) => cb());
}

/** Wrap the console methods once. Original behaviour is unchanged. */
export function installLogCapture() {
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    const original = console[level] ? console[level].bind(console) : () => {};
    console[level] = (...args) => {
      try {
        push(level, args);
      } catch {
        // logging must never throw
      }
      original(...args);
    };
  }
}

export function getEntries() {
  return entries;
}

export function clearEntries() {
  entries = [];
  listeners.forEach((cb) => cb());
}

/** Calls cb whenever a line is added; returns an unsubscribe function. */
export function subscribe(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((fn) => fn !== cb);
  };
}

export function formatEntry(entry) {
  const t = new Date(entry.time).toISOString().slice(11, 23);
  const tag = entry.level === "error" ? "E" : entry.level === "warn" ? "W" : " ";
  return `${t} ${tag} ${entry.message}`;
}

export function toText() {
  return entries.map(formatEntry).join("\n");
}
