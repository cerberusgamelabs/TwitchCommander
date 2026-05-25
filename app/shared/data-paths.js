const fs = require("fs");
const path = require("path");

function getProjectRoot(currentDir) {
  return path.resolve(currentDir, "..", "..");
}

function isPackagedRuntime(currentDir) {
  return process.env.TWITCHCOMMANDER_PACKAGED === "1" ||
    String(currentDir || "").includes("resources\\app\\") ||
    String(currentDir || "").includes("resources/app/");
}

function getDataDir(currentDir) {
  if (process.env.TWITCHCOMMANDER_DATA_DIR) {
    return process.env.TWITCHCOMMANDER_DATA_DIR;
  }

  if (isPackagedRuntime(currentDir)) {
    const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableExecutableDir) {
      return path.join(portableExecutableDir, "data");
    }

    return path.join(path.dirname(process.execPath), "data");
  }

  return path.join(getProjectRoot(currentDir), "data");
}

function getDefaultDataDir(currentDir) {
  if (isPackagedRuntime(currentDir)) {
    return path.join(getProjectRoot(currentDir), "app", "default-data");
  }

  return path.join(getProjectRoot(currentDir), "data");
}

function copyIfMissing(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(destinationPath)) {
    return;
  }

  fs.copyFileSync(sourcePath, destinationPath);
}

function ensureDataFiles(currentDir) {
  const dataDir = getDataDir(currentDir);
  const defaultDataDir = getDefaultDataDir(currentDir);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  copyIfMissing(path.join(defaultDataDir, "config.json"), path.join(dataDir, "config.json"));
  copyIfMissing(path.join(defaultDataDir, "commands.json"), path.join(dataDir, "commands.json"));
  copyIfMissing(path.join(defaultDataDir, "CommandList.txt"), path.join(dataDir, "CommandList.txt"));
  copyIfMissing(path.join(defaultDataDir, "RecentCommands.json"), path.join(dataDir, "RecentCommands.json"));

  return dataDir;
}

module.exports = {
  ensureDataFiles,
  getDataDir,
  getProjectRoot
};
