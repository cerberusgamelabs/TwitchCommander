const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDataDir = path.join(projectRoot, "data");
const distRoot = path.join(projectRoot, "dist");
const targetDataDirs = [
  path.join(distRoot, "data"),
  path.join(distRoot, "win-unpacked", "data")
];
const dataFiles = [
  "config.json",
  "commands.json",
  "CommandList.txt"
];

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDataFile(fileName, destinationDir) {
  const sourcePath = path.join(sourceDataDir, fileName);
  const destinationPath = path.join(destinationDir, fileName);
  fs.copyFileSync(sourcePath, destinationPath);
}

function main() {
  if (!fs.existsSync(sourceDataDir) || !fs.existsSync(distRoot)) {
    process.exit(0);
  }

  for (const targetDir of targetDataDirs) {
    ensureDirectory(targetDir);

    for (const fileName of dataFiles) {
      copyDataFile(fileName, targetDir);
    }
  }
}

main();
