const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const dataSourceDir = path.join(projectRoot, "data");
const appDefaultDataDir = path.join(projectRoot, "app", "default-data");
const legacyAppRuntimeDir = path.join(projectRoot, "app", "runtime");
const appRuntimePackagesDir = path.join(projectRoot, "app", "runtime-packages");

const copyTargets = [
  {
    from: path.join(projectRoot, "node_modules", "@nut-tree"),
    to: path.join(appRuntimePackagesDir, "@nut-tree")
  },
  {
    from: path.join(projectRoot, "node_modules", "node-window-manager"),
    to: path.join(appRuntimePackagesDir, "node-window-manager")
  },
  {
    from: path.join(projectRoot, "node_modules", "extract-file-icon"),
    to: path.join(appRuntimePackagesDir, "extract-file-icon")
  }
];

function resetDirectory(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_) {
    // Leave existing contents in place if Windows has the folder marked read-only.
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectory(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDefaultData() {
  fs.mkdirSync(appDefaultDataDir, { recursive: true });

  for (const fileName of ["config.json", "commands.json", "CommandList.txt"]) {
    fs.copyFileSync(
      path.join(dataSourceDir, fileName),
      path.join(appDefaultDataDir, fileName)
    );
  }
}

function copyRuntimeModules() {
  try {
    fs.rmSync(legacyAppRuntimeDir, { recursive: true, force: true });
  } catch (_) {
    // Ignore cleanup failures on Windows build output.
  }
  resetDirectory(appRuntimePackagesDir);

  for (const target of copyTargets) {
    copyDirectory(target.from, target.to);
  }

  const nutJsNodeModules = path.join(appRuntimePackagesDir, "@nut-tree", "nut-js", "node_modules", "@nut-tree");
  const libnutNodeModules = path.join(appRuntimePackagesDir, "@nut-tree", "libnut", "node_modules", "@nut-tree");
  const nodeWindowManagerNodeModules = path.join(appRuntimePackagesDir, "node-window-manager", "node_modules");

  ensureDirectory(nutJsNodeModules);
  ensureDirectory(libnutNodeModules);
  ensureDirectory(nodeWindowManagerNodeModules);

  for (const packageName of ["default-clipboard-provider", "libnut", "shared", "provider-interfaces", "configs"]) {
    copyDirectory(
      path.join(appRuntimePackagesDir, "@nut-tree", packageName),
      path.join(nutJsNodeModules, packageName)
    );
  }

  for (const packageName of ["libnut-win32", "shared", "provider-interfaces", "configs"]) {
    copyDirectory(
      path.join(appRuntimePackagesDir, "@nut-tree", packageName),
      path.join(libnutNodeModules, packageName)
    );
  }

  copyDirectory(
    path.join(appRuntimePackagesDir, "extract-file-icon"),
    path.join(nodeWindowManagerNodeModules, "extract-file-icon")
  );
}

copyDefaultData();
copyRuntimeModules();
