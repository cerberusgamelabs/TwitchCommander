const path = require("path");

function getPackagedRuntimeRoots() {
  const appRoot = path.resolve(__dirname, "..");
  return [
    path.join(appRoot, "runtime-packages"),
    path.join(process.resourcesPath || "", "runtime", "node_modules")
  ];
}

function loadRuntime(moduleName) {
  try {
    return require(moduleName);
  } catch (originalError) {
    for (const runtimeRoot of getPackagedRuntimeRoots()) {
      try {
        return require(path.join(runtimeRoot, moduleName));
      } catch (_) {
        // Try the next packaged runtime root.
      }
    }

    throw originalError;
  }
}

module.exports = {
  loadRuntime
};
