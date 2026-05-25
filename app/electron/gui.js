const { app, BrowserWindow, ipcMain, shell, Menu, screen } = require("electron");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { appendStartupLog, getStartupLogPath } = require("../shared/startup-log");
appendStartupLog("gui.js bootstrap start");
const {
  appendRecentCommand,
  createRecentCommandEntry
} = require("../shared/recent-command-feed");

const { loadRuntime } = require("../shared/runtime-loader");

let mouse;
try {
  ({ mouse, Button } = loadRuntime("@nut-tree/nut-js"));
  appendStartupLog("loaded @nut-tree/nut-js");
} catch (error) {
  appendStartupLog(`failed to load @nut-tree/nut-js: ${error && error.stack ? error.stack : error}`);
  throw error;
}

const { ensureDataFiles, getProjectRoot } = require("../shared/data-paths");
const {
  buildArgumentSuffix
} = require("../shared/command-usage");
let getTargetWindowStatus;
let getConfiguredGameWindow;
let getWindowBounds;
try {
  ({ getTargetWindowStatus, getConfiguredGameWindow, getWindowBounds } = require("../shared/window-control"));
  appendStartupLog("loaded window-control");
} catch (error) {
  appendStartupLog(`failed to load window-control: ${error && error.stack ? error.stack : error}`);
  throw error;
}

appendStartupLog("gui.js loaded.");

const projectRoot = getProjectRoot(__dirname);
const dataRoot = ensureDataFiles(__dirname);
const configPath = path.join(dataRoot, "config.json");
const commandsPath = path.join(dataRoot, "commands.json");
const commandListPath = path.join(dataRoot, "CommandList.txt");
const recentCommandsPath = path.join(dataRoot, "RecentCommands.json");
const rendererPath = path.join(projectRoot, "app", "renderer", "index.html");
const botEntryPath = path.join(projectRoot, "app", "bot", "main.js");
const TWITCH_CLIENT_ID = "chtjqkfyyjdyzxalzjnrfr5wg9c3b8";
const SYSTEM_PROC_PREFIXES = [
  "system", "svchost", "winlogon", "csrss", "smss", "lsass", "services",
  "wininit", "dwm", "conhost", "dllhost", "spoolsv", "taskhostw", "sihost",
  "fontdrvhost", "runtimebroker", "searchhost", "startmenuexperiencehost",
  "applicationframehost", "shellexperiencehost", "textinputhost",
  "registry", "memory compression", "secure system", "idle", "wsl",
  "bash", "sh", "zsh", "fish", "powershell", "cmd", "node", "electron",
  "twitchcommander"
];

let mainWindow;
let nodeProcess;
let startedAt = null;
let oauthFlowInProgress = false;
let coordinatePickerWindows = [];

app.disableHardwareAcceleration();
appendStartupLog(`startup log path: ${getStartupLogPath()}`);

process.on("warning", (warning) => {
  const isFetchExperimentalWarning =
    warning.name === "ExperimentalWarning" &&
    String(warning.message || "").includes("The Fetch API is an experimental feature");

  if (!isFetchExperimentalWarning) {
    appendStartupLog(`warning: ${warning.name}: ${warning.message}`);
    console.warn(warning);
  }
});

process.on("uncaughtException", (error) => {
  appendStartupLog(`uncaughtException: ${error && error.stack ? error.stack : error}`);
});

process.on("unhandledRejection", (reason) => {
  appendStartupLog(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});

function sendLog(channel, message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, `${message}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

mouse.config.autoDelayMs = 0;

function getDisplayList() {
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: `${display.label || getDisplayLabel(display, index)} (${display.bounds.width}x${display.bounds.height} @ ${display.bounds.x}, ${display.bounds.y})`,
    bounds: {
      x: Number(display.bounds.x || 0),
      y: Number(display.bounds.y || 0),
      width: Number(display.bounds.width || 0),
      height: Number(display.bounds.height || 0)
    }
  }));
}

function getConfiguredDisplayBounds(config) {
  const gameWindow = getConfiguredGameWindow(config);
  if (
    gameWindow.displayBounds &&
    Number.isFinite(Number(gameWindow.displayBounds.width)) &&
    Number.isFinite(Number(gameWindow.displayBounds.height))
  ) {
    return {
      x: Number(gameWindow.displayBounds.x || 0),
      y: Number(gameWindow.displayBounds.y || 0),
      width: Number(gameWindow.displayBounds.width || 0),
      height: Number(gameWindow.displayBounds.height || 0)
    };
  }

  return null;
}

function toNutButton(button) {
  switch (String(button || "left").toLowerCase()) {
    case "left":
      return Button.LEFT;
    case "middle":
      return Button.MIDDLE;
    case "right":
      return Button.RIGHT;
    default:
      return null;
  }
}

function findTargetWindowForConfig(config) {
  const targetConfig = getConfiguredGameWindow(config);
  const { windowManager } = loadRuntime("node-window-manager");
  const matches = windowManager.getWindows().filter((windowRef) => {
    try {
      if (!windowRef.isVisible() || !windowRef.isWindow()) {
        return false;
      }

      const processName = path.basename(windowRef.path || "").replace(/\.exe$/i, "").toLowerCase();
      const wantedProcess = String(targetConfig.processName || "").replace(/\.exe$/i, "").toLowerCase();
      const wantedTitle = String(targetConfig.windowTitle || "").trim().toLowerCase();
      const title = String(windowRef.getTitle() || "").trim().toLowerCase();
      const processMatches = !wantedProcess || processName === wantedProcess;
      const titleMatches = !wantedTitle || title.includes(wantedTitle);
      return processMatches && titleMatches;
    } catch (_) {
      return false;
    }
  });

  if (!matches.length) {
    throw new Error(`${targetConfig.processName} is not open in a visible window.`);
  }

  return matches[0];
}

function getConfigForGame(gameKey) {
  const config = readJson(configPath);
  config.gameWindows = config.gameWindows || {};
  if (gameKey) {
    config.game = gameKey;
    config.gameWindow = config.gameWindows[gameKey] || config.gameWindow || {};
  }
  return config;
}

function screenToRelativeGamePosition(gameKey, screenX, screenY) {
  const config = getConfigForGame(gameKey);
  const bounds = getConfiguredDisplayBounds(config) || getWindowBounds(findTargetWindowForConfig(config));
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    throw new Error("No bounded input area is configured for this game.");
  }

  const relativeX = Number(screenX) - bounds.x;
  const relativeY = Number(screenY) - bounds.y;
  if (relativeX < 0 || relativeY < 0 || relativeX >= bounds.width || relativeY >= bounds.height) {
    throw new Error(`Point ${screenX}, ${screenY} is outside the bounded input area ${bounds.width}x${bounds.height}.`);
  }

  return {
    x: relativeX,
    y: relativeY,
    bounds
  };
}

function relativeToScreenGamePosition(gameKey, relativeX, relativeY) {
  const config = getConfigForGame(gameKey);
  const bounds = getConfiguredDisplayBounds(config) || getWindowBounds(findTargetWindowForConfig(config));
  const x = Number(relativeX);
  const y = Number(relativeY);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Mouse test requires valid X and Y coordinates.");
  }

  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    throw new Error("No bounded input area is configured for this game.");
  }

  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
    throw new Error(`Mouse coordinates ${x}, ${y} are outside the bounded input area ${bounds.width}x${bounds.height}.`);
  }

  return {
    x: bounds.x + x,
    y: bounds.y + y,
    bounds
  };
}

function buildCommandList(config, commands) {
  const gameCommands = commands[config.game] || {};
  let commandList = "Commands:\n";
  for (const action in gameCommands) {
    const details = gameCommands[action];
    commandList += `  ${config.trigger}${details.name} - ${details.description}\n`;
  }

  const bitCommands = Object.values(gameCommands)
    .filter((details) => Number.isFinite(Number(details?.bitCost)) && Number(details.bitCost) > 0)
    .sort((a, b) => Number(a.bitCost) - Number(b.bitCost));
  if (bitCommands.length) {
    commandList += "\nBit Rewards:\n";
    for (const details of bitCommands) {
      commandList += `  cheer${Math.floor(Number(details.bitCost))}${buildArgumentSuffix(details)} - ${details.description}\n`;
    }
  }
  return commandList;
}

function writeCommandListFile() {
  const config = readJson(configPath);
  const commands = readJson(commandsPath);
  fs.writeFileSync(commandListPath, buildCommandList(config, commands), "utf8");
  return commandListPath;
}

function getAppState() {
  return {
    config: readJson(configPath),
    commands: readJson(commandsPath),
    process: {
      running: Boolean(nodeProcess),
      startedAt
    }
  };
}

function sendProcessStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("process-status", {
    running: Boolean(nodeProcess),
    startedAt
  });
}

function sendEvent(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

async function postForm(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(data)
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }

  return body;
}

async function validateAccessToken(accessToken) {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: {
      Authorization: `OAuth ${accessToken}`
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || `Token validation failed with HTTP ${response.status}`);
  }

  return body;
}

async function pollForDeviceToken(clientId, deviceData) {
  const started = Date.now();
  const intervalMs = Number(deviceData.interval || 5) * 1000;
  const expiresMs = Number(deviceData.expires_in || 1800) * 1000;

  while (Date.now() - started < expiresMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    try {
      const tokenData = await postForm("https://id.twitch.tv/oauth2/token", {
        client_id: clientId,
        scope: "chat:read chat:edit",
        device_code: deviceData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });

      return tokenData;
    } catch (error) {
      const message = String(error.message || error);
      if (
        message.includes("authorization_pending") ||
        message.includes("slow_down")
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Device authorization expired before Twitch returned a token.");
}

function createWindow() {
  appendStartupLog(`createWindow called with rendererPath=${rendererPath}`);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1100,
    minHeight: 760,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
    appendStartupLog(`did-fail-load: code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    appendStartupLog("did-finish-load");
  });

  mainWindow.on("ready-to-show", () => {
    appendStartupLog("ready-to-show");
  });

  mainWindow.on("closed", () => {
    appendStartupLog("main window closed");
  });

  mainWindow.loadFile(rendererPath);
  appendStartupLog("mainWindow.loadFile invoked");
}

function closeCoordinatePickerWindow() {
  for (const pickerWindow of coordinatePickerWindows) {
    if (pickerWindow && !pickerWindow.isDestroyed()) {
      pickerWindow.close();
    }
  }
  coordinatePickerWindows = [];
}

function getDisplayLabel(display, index) {
  if (display.primary) {
    return "Primary";
  }

  return `Display ${index + 1}`;
}

function buildCoordinatePickerHtml(label) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Coordinate Picker</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: crosshair;
        background: rgba(16, 22, 31, 0.18);
        font-family: "Segoe UI", sans-serif;
        color: #edf3fb;
      }

      .hint {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 16px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(11, 16, 24, 0.92);
        box-shadow: 0 18px 30px rgba(0, 0, 0, 0.28);
        font-size: 14px;
        letter-spacing: 0.01em;
      }

      .display-label {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(11, 16, 24, 0.96);
        border-bottom: 1px solid rgba(255, 255, 255, 0.16);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <div class="display-label">${label}</div>
    <div class="hint">Left click to capture mouse coordinates. Press Escape to cancel.</div>
    <script>
      const { ipcRenderer } = require("electron");

      window.addEventListener("mousedown", (event) => {
        if (event.button !== 0) {
          return;
        }

        ipcRenderer.send("coordinate-picker-result", {
          cancelled: false,
          x: event.screenX,
          y: event.screenY
        });
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          ipcRenderer.send("coordinate-picker-result", { cancelled: true });
        }
      });

    </script>
  </body>
</html>`;
}

app.whenReady().then(() => {
  appendStartupLog("app.whenReady resolved");
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("get-app-state", () => {
  return getAppState();
});

ipcMain.handle("get-window-status", async () => {
  return getTargetWindowStatus(readJson(configPath));
});

ipcMain.handle("begin-coordinate-pick", async () => {
  if (coordinatePickerWindows.some((window) => window && !window.isDestroyed())) {
    return { cancelled: true };
  }

  return new Promise((resolve) => {
    let finished = false;
    const displays = screen.getAllDisplays();

    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      ipcMain.removeListener("coordinate-picker-result", handleResult);
      const pickerWindows = coordinatePickerWindows;
      coordinatePickerWindows = [];
      for (const pickerWindow of pickerWindows) {
        if (pickerWindow && !pickerWindow.isDestroyed()) {
          pickerWindow.destroy();
        }
      }
      resolve(result);
    };

    const handleResult = (_event, payload) => {
      finish(payload);
    };

    ipcMain.on("coordinate-picker-result", handleResult);

    coordinatePickerWindows = displays.map((display, index) => {
      const { x, y, width, height } = display.bounds;
      const pickerWindow = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: true,
        skipTaskbar: true,
        fullscreenable: false,
        alwaysOnTop: true,
        focusable: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      });
      pickerWindow.setAlwaysOnTop(true, "screen-saver");
      pickerWindow.moveTop();

      pickerWindow.on("closed", () => {
        finish({ cancelled: true });
      });

      pickerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildCoordinatePickerHtml(getDisplayLabel(display, index)))}`);
      return pickerWindow;
    });

    if (coordinatePickerWindows[0] && !coordinatePickerWindows[0].isDestroyed()) {
      coordinatePickerWindows[0].focus();
    }
  });
});

ipcMain.handle("get-process-list", async () => {
  try {
    const { default: psList } = await import("ps-list");
    const processes = await psList();
    const seen = new Set();

    return processes
      .map((processInfo) => String(processInfo.name || "").trim())
      .filter((name) => {
        if (!name) {
          return false;
        }

        const lower = name.toLowerCase();
        if (seen.has(lower)) {
          return false;
        }
        if (SYSTEM_PROC_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
          return false;
        }

        seen.add(lower);
        return true;
      })
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch (_) {
    return [];
  }
});

ipcMain.handle("get-display-list", async () => {
  return getDisplayList();
});

ipcMain.handle("test-mouse-action", async (_event, payload) => {
  const position = relativeToScreenGamePosition(payload?.gameKey, payload?.x, payload?.y);
  await mouse.setPosition({ x: position.x, y: position.y });
  const mappedButton = toNutButton(payload?.button);
  if (mappedButton) {
    await mouse.click(mappedButton);
  }
  return { ok: true };
});

ipcMain.handle("screen-to-game-coordinates", async (_event, payload) => {
  return screenToRelativeGamePosition(payload?.gameKey, payload?.x, payload?.y);
});

ipcMain.handle("save-app-state", (event, payload) => {
  delete payload.config.clientId;
  writeJson(configPath, payload.config);
  writeJson(commandsPath, payload.commands);
  return getAppState();
});

ipcMain.handle("test-recent-command", () => {
  const config = readJson(configPath);
  const sampleUsers = [
    "AlphaViewer",
    "IronCrafter",
    "BitBard",
    "MapGremlin",
    "CopperGhost",
    "TrainNerd",
    "RocketRat",
    "CircuitMoth"
  ];
  const sampleCommands = [
    `${config.trigger || "!"}leftclick 12 88`,
    `${config.trigger || "!"}handmine 52 41 1800`,
    `${config.trigger || "!"}movenorth 1200`,
    `${config.trigger || "!"}rotate`,
    `${config.trigger || "!"}zoomin`,
    `${config.trigger || "!"}rightclick 77 24`,
    `${config.trigger || "!"}map`,
    `${config.trigger || "!"}research`
  ];
  const sampleSources = ["vote", "bit", "immediate"];
  const randomUser = sampleUsers[Math.floor(Math.random() * sampleUsers.length)];
  const randomCommand = sampleCommands[Math.floor(Math.random() * sampleCommands.length)];
  const randomSource = sampleSources[Math.floor(Math.random() * sampleSources.length)];
  appendRecentCommand(
    recentCommandsPath,
    createRecentCommandEntry(
      randomUser,
      randomCommand,
      randomSource
    ),
    Math.max(1, Math.min(50, Number(config.recentCommandCount) || 10))
  );
  return { ok: true };
});

ipcMain.handle("clear-recent-commands", () => {
  fs.writeFileSync(recentCommandsPath, "[]", "utf8");
  return { ok: true };
});

ipcMain.handle("update-command-list", () => {
  const outputPath = writeCommandListFile();
  return { outputPath };
});

ipcMain.on("open-oauth-link", () => {
  shell.openExternal("https://twitchapps.com/tmi/");
});

ipcMain.handle("copy-oauth-token", async () => {
  const config = readJson(configPath);
  if (!config.oauth) {
    throw new Error("No OAuth token is currently stored.");
  }

  const { clipboard } = require("electron");
  clipboard.writeText(config.oauth);
  return true;
});

ipcMain.on("exit-app", () => {
  closeCoordinatePickerWindow();
  app.quit();
});

ipcMain.handle("begin-twitch-auth", async () => {
  if (oauthFlowInProgress) {
    return { started: false, message: "OAuth flow is already in progress." };
  }

  oauthFlowInProgress = true;
  sendLog("node-process-stdout", "[GUI] Starting Twitch device authorization flow.");

  try {
    const deviceData = await postForm("https://id.twitch.tv/oauth2/device", {
      client_id: TWITCH_CLIENT_ID,
      scopes: "chat:read chat:edit"
    });

    sendLog("node-process-stdout", `[GUI] Open this URL and authorize the bot: ${deviceData.verification_uri}`);
    sendLog("node-process-stdout", `[GUI] User code: ${deviceData.user_code}`);
    shell.openExternal(deviceData.verification_uri);
    sendEvent("oauth-status", {
      kind: "started",
      verificationUri: deviceData.verification_uri,
      userCode: deviceData.user_code
    });

    const tokenData = await pollForDeviceToken(TWITCH_CLIENT_ID, deviceData);
    const validation = await validateAccessToken(tokenData.access_token);
    const config = readJson(configPath);
    delete config.clientId;
    config.username = validation.login;
    config.channel = `#${validation.login}`;
    config.oauth = `oauth:${tokenData.access_token}`;
    config.refreshToken = tokenData.refresh_token || "";
    config.scopes = tokenData.scope || validation.scopes || [];
    writeJson(configPath, config);

    sendLog("node-process-stdout", `[GUI] Twitch authorization complete for ${validation.login}.`);
    sendEvent("oauth-status", {
      kind: "success",
      config
    });

    return { started: true };
  } catch (error) {
    sendLog("node-process-stderr", `[GUI] Twitch authorization failed: ${error.message}`);
    sendEvent("oauth-status", {
      kind: "failed",
      message: error.message
    });
    throw error;
  } finally {
    oauthFlowInProgress = false;
  }
});

ipcMain.on("start-node-process", (event) => {
  if (nodeProcess) {
    sendProcessStatus();
    return;
  }

  sendLog("node-process-stdout", "Launching Bot Instance");

  nodeProcess = childProcess.spawn(process.execPath, [botEntryPath], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TWITCHCOMMANDER_DATA_DIR: dataRoot,
      TWITCHCOMMANDER_PACKAGED: app.isPackaged ? "1" : "0"
    }
  });
  startedAt = Date.now();
  sendProcessStatus();

  nodeProcess.stdout.on("data", (data) => {
    event.sender.send("node-process-stdout", data.toString());
  });

  nodeProcess.stderr.on("data", (data) => {
    event.sender.send("node-process-stderr", data.toString());
  });

  nodeProcess.on("error", (error) => {
    sendLog("node-process-stderr", `[GUI] Failed to start bot process: ${error.message}`);
  });

  nodeProcess.on("exit", (code, signal) => {
    sendLog("node-process-stderr", `[GUI] Bot process exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    nodeProcess = null;
    startedAt = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("node-process-exit");
    }
    sendProcessStatus();
  });
});

ipcMain.on("stop-node-process", () => {
  if (!nodeProcess) {
    sendProcessStatus();
    return;
  }

  nodeProcess.kill();
  nodeProcess = null;
  startedAt = null;
  sendProcessStatus();
});
