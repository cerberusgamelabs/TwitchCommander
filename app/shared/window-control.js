const path = require("path");
const ActiveWindowModule = require("@paymoapp/active-window");
const { loadRuntime } = require("./runtime-loader");
const { windowManager } = loadRuntime("node-window-manager");

const ActiveWindow = ActiveWindowModule.default || ActiveWindowModule.ActiveWindow || ActiveWindowModule;

let activeWindowInitialized = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProcessName(value) {
  const normalized = normalizeString(value);
  return normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized;
}

function getProcessNameFromPath(filePath) {
  if (!filePath) {
    return "";
  }

  return normalizeProcessName(path.basename(String(filePath)));
}

function initializeActiveWindow() {
  if (activeWindowInitialized) {
    return;
  }

  try {
    ActiveWindow.initialize();
  } catch (_) {
    // Ignore initialization failures and let runtime calls fall back.
  }

  activeWindowInitialized = true;
}

function getConfiguredGameWindow(config) {
  const defaults = {
    bibites: {
      processName: "Bibites",
      windowTitle: "Bibites"
    }
  };

  const gameKey = config.game || "";
  const gameSpecific = config.gameWindows && config.gameWindows[gameKey]
    ? config.gameWindows[gameKey]
    : {};
  const configured = config.gameWindow || {};
  const gameDefaults = defaults[gameKey] || {};

  return {
    processName: gameSpecific.processName || configured.processName || gameDefaults.processName || gameKey,
    windowTitle: gameSpecific.windowTitle || configured.windowTitle || gameDefaults.windowTitle || gameKey,
    displayId: gameSpecific.displayId || configured.displayId || "",
    displayLabel: gameSpecific.displayLabel || configured.displayLabel || "",
    displayBounds: gameSpecific.displayBounds || configured.displayBounds || null
  };
}

function getConfiguredInputBounds(config, targetWindow) {
  const targetConfig = getConfiguredGameWindow(config);
  const displayBounds = targetConfig.displayBounds;
  if (
    displayBounds &&
    Number.isFinite(Number(displayBounds.width)) &&
    Number.isFinite(Number(displayBounds.height))
  ) {
    return {
      x: Number(displayBounds.x || 0),
      y: Number(displayBounds.y || 0),
      width: Number(displayBounds.width || 0),
      height: Number(displayBounds.height || 0),
      label: targetConfig.displayLabel || "Selected display"
    };
  }

  const windowBounds = getWindowBounds(targetWindow);
  if (!windowBounds) {
    return null;
  }

  return {
    ...windowBounds,
    label: "Target window"
  };
}

function safeGetActiveWindowInfo() {
  initializeActiveWindow();

  try {
    const activeWindowInfo = ActiveWindow.getActiveWindow();
    if (activeWindowInfo) {
      return {
        id: null,
        title: activeWindowInfo.title || "",
        path: activeWindowInfo.path || "",
        processId: Number(activeWindowInfo.pid || 0),
        application: activeWindowInfo.application || "",
        processName: getProcessNameFromPath(activeWindowInfo.path) || normalizeProcessName(activeWindowInfo.application)
      };
    }
  } catch (_) {
    // Fall through to node-window-manager.
  }

  try {
    const activeWindow = windowManager.getActiveWindow();
    if (activeWindow && activeWindow.id) {
      return {
        id: activeWindow.id,
        title: activeWindow.getTitle() || "",
        path: activeWindow.path || "",
        processId: Number(activeWindow.processId || 0),
        application: path.basename(activeWindow.path || ""),
        processName: getProcessNameFromPath(activeWindow.path)
      };
    }
  } catch (_) {
    // Ignore and return null below.
  }

  return null;
}

function getAllWindows() {
  try {
    return windowManager.getWindows();
  } catch (_) {
    return [];
  }
}

function buildWindowSnapshot(windowRef) {
  if (!windowRef || !windowRef.id) {
    return null;
  }

  let title = "";
  try {
    title = windowRef.getTitle() || "";
  } catch (_) {
    title = "";
  }

  return {
    id: windowRef.id,
    title,
    path: windowRef.path || "",
    processId: Number(windowRef.processId || 0),
    processName: getProcessNameFromPath(windowRef.path)
  };
}

function matchesConfiguredWindow(windowInfo, targetConfig) {
  if (!windowInfo) {
    return false;
  }

  const wantedProcess = normalizeProcessName(targetConfig.processName);
  const wantedTitle = normalizeString(targetConfig.windowTitle);
  const actualProcess = normalizeProcessName(windowInfo.processName || windowInfo.application || windowInfo.path);
  const actualTitle = normalizeString(windowInfo.title);

  const processMatches = !wantedProcess || actualProcess === wantedProcess;
  const titleMatches = !wantedTitle || actualTitle.includes(wantedTitle);

  return processMatches && titleMatches;
}

function findTargetWindow(targetConfig) {
  const wantedProcess = normalizeProcessName(targetConfig.processName);
  const wantedTitle = normalizeString(targetConfig.windowTitle);
  const windows = getAllWindows();
  const visibleWindows = windows.filter((windowRef) => {
    try {
      return windowRef.isVisible() && windowRef.isWindow();
    } catch (_) {
      return false;
    }
  });

  const rankedWindows = visibleWindows
    .map((windowRef) => ({
      windowRef,
      snapshot: buildWindowSnapshot(windowRef)
    }))
    .filter(({ snapshot }) => snapshot && snapshot.id)
    .map((entry) => {
      let score = 0;
      const actualProcess = normalizeProcessName(entry.snapshot.processName);
      const actualTitle = normalizeString(entry.snapshot.title);

      if (wantedProcess && actualProcess === wantedProcess) {
        score += 2;
      }
      if (wantedTitle && actualTitle.includes(wantedTitle)) {
        score += 1;
      }

      return {
        ...entry,
        score
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return rankedWindows[0] || null;
}

function getWindowBounds(windowRef) {
  if (!windowRef || !windowRef.id) {
    return null;
  }

  try {
    const bounds = windowRef.getBounds();
    if (!bounds) {
      return null;
    }

    return {
      x: Number(bounds.x || 0),
      y: Number(bounds.y || 0),
      width: Number(bounds.width || 0),
      height: Number(bounds.height || 0)
    };
  } catch (_) {
    return null;
  }
}

function findWindowBySnapshot(windowInfo) {
  if (!windowInfo) {
    return null;
  }

  const wantedProcess = normalizeProcessName(windowInfo.processName || windowInfo.application || windowInfo.path);
  const wantedTitle = normalizeString(windowInfo.title);
  const wantedPid = Number(windowInfo.processId || 0);

  const candidates = getAllWindows()
    .map((windowRef) => ({
      windowRef,
      snapshot: buildWindowSnapshot(windowRef)
    }))
    .filter(({ snapshot }) => snapshot && snapshot.id);

  const ranked = candidates
    .map((entry) => {
      let score = 0;
      if (wantedPid && entry.snapshot.processId === wantedPid) {
        score += 3;
      }
      if (wantedProcess && normalizeProcessName(entry.snapshot.processName) === wantedProcess) {
        score += 2;
      }
      if (wantedTitle && normalizeString(entry.snapshot.title) === wantedTitle) {
        score += 1;
      }

      return {
        ...entry,
        score
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.windowRef || null;
}

async function focusWindow(windowRef) {
  if (!windowRef || !windowRef.id) {
    return false;
  }

  try {
    windowRef.restore();
  } catch (_) {
    // Ignore restore failures.
  }

  try {
    windowRef.show();
  } catch (_) {
    // Ignore show failures.
  }

  try {
    windowRef.bringToTop();
  } catch (_) {
    return false;
  }

  await sleep(150);
  return true;
}

function describeWindow(windowInfo) {
  if (!windowInfo) {
    return "No active window detected.";
  }

  const title = windowInfo.title || "(untitled window)";
  const processName = windowInfo.processName || windowInfo.application || "unknown process";
  return `${title} [${processName}]`;
}

async function getTargetWindowStatus(config) {
  const targetConfig = getConfiguredGameWindow(config);
  if (!normalizeProcessName(targetConfig.processName)) {
    return {
      active: false,
      label: "Target Not Set",
      reason: "No target process name is configured for the active game."
    };
  }

  const activeWindow = safeGetActiveWindowInfo();
  const targetEntry = findTargetWindow(targetConfig);

  if (!targetEntry) {
    return {
      active: false,
      label: "Target Not Running",
      reason: `${targetConfig.processName} is not open in a visible window.`
    };
  }

  if (matchesConfiguredWindow(activeWindow, targetConfig)) {
    return {
      active: true,
      label: "Target Active",
      reason: `${targetEntry.snapshot.title || targetConfig.processName} is focused.`,
      activeWindow,
      targetWindow: targetEntry.snapshot
    };
  }

  return {
    active: false,
    label: "Target Not Active",
    reason: `Focused window: ${describeWindow(activeWindow)}`,
    activeWindow,
    targetWindow: targetEntry.snapshot
  };
}

async function prepareTargetWindow(config) {
  const targetConfig = getConfiguredGameWindow(config);
  const status = await getTargetWindowStatus(config);
  if (!status.targetWindow) {
    return {
      ready: false,
      switched: false,
      previousWindow: null,
      targetWindow: null,
      reason: status.reason
    };
  }

  const targetEntry = findTargetWindow(targetConfig);
  if (!targetEntry) {
    return {
      ready: false,
      switched: false,
      previousWindow: null,
      targetWindow: null,
      reason: `${targetConfig.processName} is not open in a visible window.`
    };
  }

  let previousWindow = null;
  try {
    previousWindow = windowManager.getActiveWindow();
  } catch (_) {
    previousWindow = null;
  }
  const previousWindowSnapshot = buildWindowSnapshot(previousWindow) || safeGetActiveWindowInfo();

  const alreadyActive = previousWindow && previousWindow.id
    ? previousWindow.id === targetEntry.windowRef.id
    : matchesConfiguredWindow(previousWindowSnapshot, targetConfig);
  if (!alreadyActive) {
    const focused = await focusWindow(targetEntry.windowRef);
    if (!focused) {
      return {
        ready: false,
        switched: false,
        previousWindow: previousWindowSnapshot,
        targetWindow: targetEntry.windowRef,
        reason: `Unable to focus ${targetConfig.processName} before sending inputs.`
      };
    }
  }

  return {
    ready: true,
    switched: !alreadyActive,
    previousWindow: previousWindow && previousWindow.id ? previousWindow : previousWindowSnapshot,
    targetWindow: targetEntry.windowRef,
    bounds: getConfiguredInputBounds(config, targetEntry.windowRef),
    reason: alreadyActive ? "Target window already focused." : `Focused ${targetConfig.processName} for automation.`
  };
}

async function restorePreviousWindow(previousWindow, targetWindow) {
  if (!previousWindow || !previousWindow.id) {
    const matchedWindow = findWindowBySnapshot(previousWindow);
    if (!matchedWindow || (targetWindow && matchedWindow.id === targetWindow.id)) {
      return false;
    }

    return focusWindow(matchedWindow);
  }

  if (targetWindow && previousWindow.id === targetWindow.id) {
    return true;
  }

  return focusWindow(previousWindow);
}

module.exports = {
  getConfiguredGameWindow,
  getConfiguredInputBounds,
  getTargetWindowStatus,
  getWindowBounds,
  prepareTargetWindow,
  restorePreviousWindow
};
