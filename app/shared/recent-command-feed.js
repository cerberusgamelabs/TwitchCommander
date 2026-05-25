const fs = require("fs");
const VALID_SOURCES = new Set(["vote", "bit", "immediate"]);

function normalizeRecentCommandSource(source) {
  const normalized = String(source || "").toLowerCase();
  return VALID_SOURCES.has(normalized) ? normalized : "vote";
}

function ensureRecentCommandFeedFile(filePath) {
  if (fs.existsSync(filePath)) {
    return;
  }

  fs.writeFileSync(filePath, "[]", "utf8");
}

function readRecentCommandFeed(filePath) {
  ensureRecentCommandFeedFile(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: String(entry.id || ""),
        username: String(entry.username || "unknown"),
        command: String(entry.command || ""),
        timestamp: String(entry.timestamp || ""),
        source: normalizeRecentCommandSource(entry.source)
      }))
      .filter((entry) => entry.id && entry.command);
  } catch (_) {
    return [];
  }
}

function writeRecentCommandFeed(filePath, entries) {
  ensureRecentCommandFeedFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf8");
}

function createRecentCommandEntry(username, command, source = "vote") {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: String(username || "unknown"),
    command: String(command || ""),
    timestamp,
    source: normalizeRecentCommandSource(source)
  };
}

function appendRecentCommand(filePath, entry, limit) {
  const entries = readRecentCommandFeed(filePath);
  entries.push(entry);
  const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const trimmed = entries.slice(-boundedLimit);
  writeRecentCommandFeed(filePath, trimmed);
  return trimmed;
}

module.exports = {
  appendRecentCommand,
  createRecentCommandEntry,
  ensureRecentCommandFeedFile,
  normalizeRecentCommandSource,
  readRecentCommandFeed,
  writeRecentCommandFeed
};
