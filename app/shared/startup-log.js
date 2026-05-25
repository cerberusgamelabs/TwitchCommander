const fs = require("fs");
const path = require("path");

function getStartupLogPath() {
  if (process.resourcesPath) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      return path.join(portableDir, "startup.log");
    }

    return path.join(path.dirname(process.execPath), "startup.log");
  }

  return path.resolve(__dirname, "..", "..", "startup.log");
}

function appendStartupLog(message) {
  try {
    const logPath = getStartupLogPath();
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch (_) {
    // Ignore logging failures.
  }
}

module.exports = {
  appendStartupLog,
  getStartupLogPath
};
