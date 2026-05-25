      const { ipcRenderer } = require("electron");

      const {
        buildCommandUsage: buildUsageString,
        hasArgumentPlaceholders,
        getRequiredArgumentCount
      } = require("../shared/command-usage");

      const dom = {
        navMainButton: document.getElementById("nav-main-button"),
        navSettingsButton: document.getElementById("nav-settings-button"),
        gamesMenuButton: document.getElementById("games-menu-button"),
        gamesMenuPanel: document.getElementById("games-menu-panel"),
        exitButton: document.getElementById("exit-button"),
        pageMain: document.getElementById("page-main"),
        pageSettings: document.getElementById("page-settings"),
        pageAddGame: document.getElementById("page-add-game"),
        pageGame: document.getElementById("page-game"),
        startButton: document.getElementById("start-button"),
        stopButton: document.getElementById("stop-button"),
        saveButton: document.getElementById("save-button"),
        updateCommandListButton: document.getElementById("update-command-list-button"),
        updateCommandListButtonSettings: document.getElementById("update-command-list-button-settings"),
        reloadButton: document.getElementById("reload-button"),
        headerWindowChip: document.getElementById("header-window-chip"),
        headerStatusChip: document.getElementById("header-status-chip"),
        homeStartButton: document.getElementById("home-start-button"),
        homeStopButton: document.getElementById("home-stop-button"),
        homeSaveButton: document.getElementById("home-save-button"),
        messageBanner: document.getElementById("message-banner"),
        username: document.getElementById("username"),
        channel: document.getElementById("channel"),
        oauthButton: document.getElementById("oauth-button"),
        copyOauthButton: document.getElementById("copy-oauth-button"),
        oauthStatusPill: document.getElementById("oauth-status-pill"),
        trigger: document.getElementById("trigger"),
        voteLength: document.getElementById("vote-length"),
        recentCommandCount: document.getElementById("recent-command-count"),
        testRecentCommandButton: document.getElementById("test-recent-command-button"),
        clearRecentCommandsButton: document.getElementById("clear-recent-commands-button"),
        activeGame: document.getElementById("active-game"),
        gameProcess: document.getElementById("game-process"),
        gameProcessSelect: document.getElementById("game-process-select"),
        useGameProcessButton: document.getElementById("use-game-process-button"),
        refreshGameProcessesButton: document.getElementById("refresh-game-processes-button"),
        gameTitle: document.getElementById("game-title"),
        gameDisplay: document.getElementById("game-display"),
        bitRewards: document.getElementById("bit-rewards"),
        addGameKey: document.getElementById("add-game-key"),
        addGameProcess: document.getElementById("add-game-process"),
        addGameProcessSelect: document.getElementById("add-game-process-select"),
        useAddGameProcessButton: document.getElementById("use-add-game-process-button"),
        refreshAddGameProcessesButton: document.getElementById("refresh-add-game-processes-button"),
        addGameTitle: document.getElementById("add-game-title"),
        addGameDisplay: document.getElementById("add-game-display"),
        createGameButton: document.getElementById("create-game-button"),
        duplicateGameButton: document.getElementById("duplicate-game-button"),
        deleteGameButton: document.getElementById("delete-game-button"),
        selectedGameKey: document.getElementById("selected-game-key"),
        gamePageHeading: document.getElementById("game-page-heading"),
        gameEditorTitle: document.getElementById("game-editor-title"),
        gameEditorSubtitle: document.getElementById("game-editor-subtitle"),
        commandNavList: document.getElementById("command-nav-list"),
        commandsContainer: document.getElementById("commands-container"),
        addCommandButton: document.getElementById("add-command-button"),
        newCommandKey: document.getElementById("new-command-key"),
        botLogsTab: document.getElementById("bot-logs-tab"),
        errorLogsTab: document.getElementById("error-logs-tab"),
        logs: document.getElementById("logs"),
        errors: document.getElementById("errors")
      };

      const state = {
        config: null,
        commands: null,
        page: "main",
        selectedGame: null,
        selectedCommand: null,
        gamesMenuOpen: false,
        activeLogTab: "bot",
        process: {
          running: false,
          startedAt: null
        },
        targetWindow: {
          active: false,
          label: "Target Not Active",
          reason: ""
        },
        runningApps: [],
        displays: [],
        pendingStartAfterAuth: false
      };

      function setMessage(message, kind = "") {
        dom.messageBanner.textContent = message;
        dom.messageBanner.className = `banner tiny${kind ? ` ${kind}` : ""}`;
      }

      function sanitizeKey(value) {
        return (value || "").trim().toLowerCase().replace(/\s+/g, "_");
      }

      function normalizeChannel(value) {
        const trimmed = (value || "").trim();
        if (!trimmed) {
          return "";
        }

        return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
      }

      function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
      }

      function hasUsableOAuth() {
        const oauth = (state.config?.oauth || "").trim();
        return oauth.startsWith("oauth:") && oauth.length > "oauth:".length;
      }

      function ensureSelectedGame() {
        const gameKeys = Object.keys(state.commands || {});
        if (!gameKeys.length) {
          state.selectedGame = null;
          state.selectedCommand = null;
          return;
        }

        if (!state.selectedGame || !state.commands[state.selectedGame]) {
          state.selectedGame = state.config.game && state.commands[state.config.game]
            ? state.config.game
            : gameKeys[0];
        }

        const commandKeys = Object.keys(state.commands[state.selectedGame] || {});
        if (!commandKeys.length) {
          state.selectedCommand = null;
          return;
        }

        if (!state.selectedCommand || !state.commands[state.selectedGame][state.selectedCommand]) {
          state.selectedCommand = commandKeys[0];
        }
      }

      function navigateTo(page) {
        state.page = page;
        renderAll();
      }

      function renderNav() {
        dom.navMainButton.className = `nav-button${state.page === "main" ? " active" : ""}`;
        dom.navSettingsButton.className = `nav-button${state.page === "settings" ? " active" : ""}`;
        dom.gamesMenuButton.className = `nav-button${state.page === "game" || state.page === "add-game" || state.gamesMenuOpen ? " active" : ""}`;

        const gameKeys = Object.keys(state.commands || {});
        dom.gamesMenuPanel.innerHTML = "";

        gameKeys.forEach((gameKey) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "menu-item";
          item.textContent = gameKey;
          item.addEventListener("click", () => {
            state.selectedGame = gameKey;
            state.selectedCommand = Object.keys(state.commands[state.selectedGame] || {})[0] || null;
            state.gamesMenuOpen = false;
            navigateTo("game");
          });
          dom.gamesMenuPanel.appendChild(item);
        });

        const divider = document.createElement("div");
        divider.className = "menu-divider";
        dom.gamesMenuPanel.appendChild(divider);

        const addItem = document.createElement("button");
        addItem.type = "button";
        addItem.className = "menu-item";
        addItem.textContent = "Add Game";
        addItem.addEventListener("click", () => {
          state.gamesMenuOpen = false;
          navigateTo("add-game");
        });
        dom.gamesMenuPanel.appendChild(addItem);
        dom.gamesMenuPanel.hidden = !state.gamesMenuOpen;
      }

      function renderPages() {
        dom.pageMain.classList.toggle("active", state.page === "main");
        dom.pageSettings.classList.toggle("active", state.page === "settings");
        dom.pageAddGame.classList.toggle("active", state.page === "add-game");
        dom.pageGame.classList.toggle("active", state.page === "game");
      }

      function renderProcessStatus() {
        const running = state.process.running;
        const statusText = running ? "Bot running" : "Bot stopped";
        const statusClass = `status-chip ${running ? "running" : "stopped"}`;
        const targetActive = Boolean(state.targetWindow?.active);
        const targetClass = `status-chip ${targetActive ? "running" : "stopped"}`;
        dom.headerWindowChip.textContent = state.targetWindow?.label || "Target Not Active";
        dom.headerWindowChip.className = targetClass;
        dom.headerWindowChip.title = state.targetWindow?.reason || "";
        dom.headerStatusChip.textContent = statusText;
        dom.headerStatusChip.className = statusClass;
        dom.startButton.disabled = running;
        dom.stopButton.disabled = !running;
        dom.homeStartButton.disabled = running;
        dom.homeStopButton.disabled = !running;
      }

      function renderLogTabs() {
        const showBot = state.activeLogTab === "bot";
        dom.logs.hidden = !showBot;
        dom.errors.hidden = showBot;
        dom.botLogsTab.className = `tab-button${showBot ? " active" : ""}`;
        dom.errorLogsTab.className = `tab-button${showBot ? "" : " active"}`;
      }

      function renderSettings() {
        const config = state.config;
        const gameKeys = Object.keys(state.commands);

        dom.username.value = config.username || "";
        dom.channel.value = normalizeChannel(config.channel || "");
        dom.trigger.value = config.trigger || "!";
        dom.voteLength.value = config.tL || 15;
        dom.bitRewards.value = String(Boolean(config.bitRewards));
        dom.recentCommandCount.value = config.recentCommandCount || 10;

        dom.activeGame.innerHTML = "";
        gameKeys.forEach((gameKey) => {
          const option = document.createElement("option");
          option.value = gameKey;
          option.textContent = gameKey;
          if (config.game === gameKey) {
            option.selected = true;
          }
          dom.activeGame.appendChild(option);
        });

        const selectedWindow = getWindowConfigForGame(state.selectedGame || config.game);
        const gameWindow = selectedWindow || config.gameWindow || {};
        dom.gameProcess.value = gameWindow.processName || "";
        dom.gameTitle.value = gameWindow.windowTitle || "";
        renderDisplaySelect(dom.gameDisplay, gameWindow.displayId || "");
        renderDisplaySelect(dom.addGameDisplay, dom.addGameDisplay.value || "");
        dom.oauthStatusPill.textContent = hasUsableOAuth() ? "Set" : "Not Set";
        dom.oauthStatusPill.className = `pill ${hasUsableOAuth() ? "ok" : "warn"}`;
        renderRunningAppSelects();
      }

      function getWindowConfigForGame(gameKey) {
        const gameWindows = state.config.gameWindows || {};
        return gameWindows[gameKey] || null;
      }

      function renderCommandNav() {
        ensureSelectedGame();
        dom.commandNavList.innerHTML = "";

        if (!state.selectedGame) {
          dom.commandNavList.innerHTML = '<div class="empty">No games defined yet.</div>';
          return;
        }

        const commandKeys = Object.keys(state.commands[state.selectedGame] || {});
        if (!commandKeys.length) {
          dom.commandNavList.innerHTML = '<div class="empty">No commands yet.</div>';
          return;
        }

        commandKeys.forEach((commandKey) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `command-nav-button${state.selectedCommand === commandKey ? " active" : ""}`;
          button.textContent = commandKey;
          button.addEventListener("click", () => {
            state.selectedCommand = commandKey;
            renderCommandNav();
            renderSelectedGameEditor();
          });
          dom.commandNavList.appendChild(button);
        });
      }

      function parseAction(action) {
        const parts = String(action || "").split("|");
        const type = parts[0] || "keytap";

        if (type === "mouse") {
          return {
            type,
            x: parts[1] || "0",
            y: parts[2] || "0",
            button: parts[3] || "none",
            shift: parts[4] === "1",
            control: parts[5] === "1",
            alt: parts[6] === "1"
          };
        }

        if (type === "mousehold") {
          return {
            type,
            x: parts[1] || "0",
            y: parts[2] || "0",
            button: parts[3] || "left",
            durationMs: parts[4] || "500",
            shift: parts[5] === "1",
            control: parts[6] === "1",
            alt: parts[7] === "1"
          };
        }

        if (type === "mousedrag") {
          return {
            type,
            startX: parts[1] || "0",
            startY: parts[2] || "0",
            endX: parts[3] || "0",
            endY: parts[4] || "0",
            button: parts[5] || "left",
            shift: parts[6] === "1",
            control: parts[7] === "1",
            alt: parts[8] === "1"
          };
        }

        if (type === "scroll") {
          return {
            type,
            amount: parts[1] || "0"
          };
        }

        if (type === "keyhold") {
          return {
            type,
            key: parts[1] || "space",
            durationMs: parts[2] || "500",
            shift: parts[3] === "1",
            control: parts[4] === "1",
            alt: parts[5] === "1"
          };
        }

        return {
          type: "keytap",
          key: parts[1] || "space",
          count: parts[2] || "1",
          shift: parts[3] === "1",
          control: parts[4] === "1",
          alt: parts[5] === "1"
        };
      }

      function buildAction(actionData) {
        if (actionData.type === "mouse") {
          return `mouse|${actionData.x || 0}|${actionData.y || 0}|${actionData.button || "none"}|${actionData.shift ? 1 : 0}|${actionData.control ? 1 : 0}|${actionData.alt ? 1 : 0}`;
        }

        if (actionData.type === "mousehold") {
          return `mousehold|${actionData.x || 0}|${actionData.y || 0}|${actionData.button || "left"}|${actionData.durationMs || 500}|${actionData.shift ? 1 : 0}|${actionData.control ? 1 : 0}|${actionData.alt ? 1 : 0}`;
        }

        if (actionData.type === "mousedrag") {
          return `mousedrag|${actionData.startX || 0}|${actionData.startY || 0}|${actionData.endX || 0}|${actionData.endY || 0}|${actionData.button || "left"}|${actionData.shift ? 1 : 0}|${actionData.control ? 1 : 0}|${actionData.alt ? 1 : 0}`;
        }

        if (actionData.type === "scroll") {
          return `scroll|${actionData.amount || 0}`;
        }

        if (actionData.type === "keyhold") {
          return `keyhold|${actionData.key || "space"}|${actionData.durationMs || 500}|${actionData.shift ? 1 : 0}|${actionData.control ? 1 : 0}|${actionData.alt ? 1 : 0}`;
        }

        return `keytap|${actionData.key || "space"}|${actionData.count || 1}|${actionData.shift ? 1 : 0}|${actionData.control ? 1 : 0}|${actionData.alt ? 1 : 0}`;
      }

      function buildCommandUsage(commandKey, command) {
        return buildUsageString(state.config?.trigger || "!", commandKey, command);
      }

      function normalizeBitCost(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return 0;
        }

        return Math.floor(parsed);
      }

      function getActionFieldConfig(type) {
        if (type === "mouse") {
          return [
            { key: "x", label: "X Position", placeholder: "40 or $1" },
            { key: "y", label: "Y Position", placeholder: "40 or $2" },
            {
              key: "button",
              label: "Button",
              control: "select",
              options: ["left", "right", "middle", "none"]
            },
            { key: "shift", label: "Shift", control: "checkbox" },
            { key: "control", label: "Ctrl", control: "checkbox" },
            { key: "alt", label: "Alt", control: "checkbox" }
          ];
        }

        if (type === "mousehold") {
          return [
            { key: "x", label: "X Position", placeholder: "40 or $1" },
            { key: "y", label: "Y Position", placeholder: "40 or $2" },
            {
              key: "button",
              label: "Button",
              control: "select",
              options: ["left", "right", "middle"]
            },
            { key: "durationMs", label: "Duration (ms)", placeholder: "500, $3, or $3?500" },
            { key: "shift", label: "Shift", control: "checkbox" },
            { key: "control", label: "Ctrl", control: "checkbox" },
            { key: "alt", label: "Alt", control: "checkbox" }
          ];
        }

        if (type === "mousedrag") {
          return [
            { key: "startX", label: "Start X", placeholder: "40 or $1" },
            { key: "startY", label: "Start Y", placeholder: "40 or $2" },
            { key: "endX", label: "End X", placeholder: "140 or $3" },
            { key: "endY", label: "End Y", placeholder: "140 or $4" },
            {
              key: "button",
              label: "Button",
              control: "select",
              options: ["left", "right", "middle"]
            },
            { key: "shift", label: "Shift", control: "checkbox" },
            { key: "control", label: "Ctrl", control: "checkbox" },
            { key: "alt", label: "Alt", control: "checkbox" }
          ];
        }

        if (type === "scroll") {
          return [
            { key: "amount", label: "Amount", placeholder: "120" }
          ];
        }

        if (type === "keyhold") {
          return [
            {
              key: "key",
              label: "Key",
              control: "select",
              options: [
                "space",
                "enter",
                "escape",
                "tab",
                "backspace",
                "delete",
                "up",
                "down",
                "left",
                "right",
                "home",
                "end",
                "pageup",
                "pagedown",
                "insert",
                "shift",
                "control",
                "alt",
                "a",
                "b",
                "c",
                "d",
                "e",
                "f",
                "g",
                "h",
                "i",
                "j",
                "k",
                "l",
                "m",
                "n",
                "o",
                "p",
                "q",
                "r",
                "s",
                "t",
                "u",
                "v",
                "w",
                "x",
                "y",
                "z",
                "0",
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "+",
                "-"
              ]
            },
            { key: "durationMs", label: "Duration (ms)", placeholder: "500, $2, or $2?500" },
            { key: "shift", label: "Shift", control: "checkbox" },
            { key: "control", label: "Ctrl", control: "checkbox" },
            { key: "alt", label: "Alt", control: "checkbox" }
          ];
        }

        return [
          {
            key: "key",
            label: "Key",
            control: "select",
            options: [
              "space",
              "enter",
              "escape",
              "tab",
              "backspace",
              "delete",
              "up",
              "down",
              "left",
              "right",
              "home",
              "end",
              "pageup",
              "pagedown",
              "insert",
              "shift",
              "control",
              "alt",
              "a",
              "b",
              "c",
              "d",
              "e",
              "f",
              "g",
              "h",
              "i",
              "j",
              "k",
              "l",
              "m",
              "n",
              "o",
              "p",
              "q",
              "r",
              "s",
              "t",
              "u",
              "v",
              "w",
              "x",
              "y",
              "z",
              "0",
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "+",
                "-"
              ]
            },
          { key: "count", label: "Times", placeholder: "1" },
          { key: "shift", label: "Shift", control: "checkbox" },
          { key: "control", label: "Ctrl", control: "checkbox" },
          { key: "alt", label: "Alt", control: "checkbox" }
        ];
      }

      function getActionHelpText(type) {
        if (type === "mouse") {
          return "Moves inside the bounded game area using display-relative coordinates if a display is selected, otherwise target-window-relative coordinates. Shift, Ctrl, and Alt checkboxes modify the exact click. Use $1, $2, etc. to pull chat arguments into a command like !leftclick 256 300.";
        }

        if (type === "mousehold") {
          return "Moves inside the bounded game area, presses and holds a mouse button for the specified number of milliseconds, then releases it. Shift, Ctrl, and Alt checkboxes modify the exact click-and-hold. You can use chat arguments like $1, $2, $3 for X, Y, and duration, or optional defaults like $3?500.";
        }

        if (type === "mousedrag") {
          return "Moves to a bounded start position, presses a mouse button, drags to a bounded end position, and releases. Shift, Ctrl, and Alt checkboxes modify the exact drag. Use chat arguments like $1, $2, $3, $4 for start and end coordinates.";
        }

        if (type === "scroll") {
          return "Scrolls vertically by the given amount. Positive and negative values control direction.";
        }

        if (type === "keyhold") {
          return "Presses and holds a keyboard key for the specified number of milliseconds, then releases it. Shift, Ctrl, and Alt checkboxes modify the exact keypress. You can use chat arguments like $1 for key and $2 for duration, or optional defaults like $2?500.";
        }

        return "Presses a keyboard key one or more times. Shift, Ctrl, and Alt checkboxes modify the exact keypress.";
      }

      function createCommandCard(commandKey, command, gameKey) {
        const card = document.createElement("div");
        card.className = "command-card";

        const actionsMarkup = command.actions.map((action, actionIndex) => {
          const parsedAction = parseAction(action);
          const fieldConfig = getActionFieldConfig(parsedAction.type);
          const modifierKeys = new Set(["shift", "control", "alt"]);
          const primaryInputs = fieldConfig.filter((field) => !modifierKeys.has(field.key)).map((field) => `
            <div class="field">
              <label>${field.label}</label>
              ${field.control === "select"
                ? `<select data-role="action-field" data-field="${field.key}">${field.options.map((option) => `<option value="${escapeHtml(option)}"${(parsedAction[field.key] || "") === option ? " selected" : ""}>${option}</option>`).join("")}</select>`
                : field.control === "checkbox"
                ? `<input
                    type="checkbox"
                    ${parsedAction[field.key] ? "checked" : ""}
                    data-role="action-field"
                    data-field="${field.key}">`
                : `<input
                    type="text"
                    value="${escapeHtml(parsedAction[field.key] || "")}"
                    placeholder="${escapeHtml(field.placeholder)}"
                    data-role="action-field"
                    data-field="${field.key}">`
              }
            </div>
          `).join("");
          const modifierInputs = fieldConfig.filter((field) => modifierKeys.has(field.key)).map((field) => `
            <label class="action-modifier-toggle">
              <span>${field.label}</span>
              <input
                type="checkbox"
                ${parsedAction[field.key] ? "checked" : ""}
                data-role="action-field"
                data-field="${field.key}">
            </label>
          `).join("");

          return `
            <div class="command-card action-card" data-action-index="${actionIndex}">
              <button type="button" class="danger icon-button action-close" data-role="remove-action" aria-label="Remove action">x</button>
              <div class="action-row">
                <div class="field">
                  <label>Action Type</label>
                  <select data-role="action-type">
                    <option value="keytap"${parsedAction.type === "keytap" ? " selected" : ""}>Key Tap</option>
                    <option value="keyhold"${parsedAction.type === "keyhold" ? " selected" : ""}>Key Hold</option>
                    <option value="mouse"${parsedAction.type === "mouse" ? " selected" : ""}>Mouse Move/Click</option>
                    <option value="mousehold"${parsedAction.type === "mousehold" ? " selected" : ""}>Mouse Hold</option>
                    <option value="mousedrag"${parsedAction.type === "mousedrag" ? " selected" : ""}>Mouse Drag</option>
                    <option value="scroll"${parsedAction.type === "scroll" ? " selected" : ""}>Scroll</option>
                  </select>
                </div>
                ${primaryInputs}
              </div>
              ${modifierInputs ? `<div class="action-modifier-row">${modifierInputs}</div>` : ""}
              <div class="action-help">${getActionHelpText(parsedAction.type)}</div>
              ${parsedAction.type === "mouse" || parsedAction.type === "mousehold" || parsedAction.type === "mousedrag" ? `
                <div class="action-tools">
                  <button type="button" data-role="pick-mouse-position">Pick Position</button>
                  <button type="button" data-role="use-chat-xy">Use Chat X/Y</button>
                  <button type="button" data-role="test-mouse-position">Test Position</button>
                </div>
              ` : ""}
              <div class="action-preview">Saved format: <span data-role="action-preview">${escapeHtml(action)}</span></div>
            </div>
          `;
        }).join("");

        card.innerHTML = `
          <div class="card-header">
            <strong>${commandKey}</strong>
            <button type="button" class="danger" data-role="delete-command">Delete</button>
          </div>
          <div class="grid-3" style="margin-top: 10px;">
            <div class="field">
              <label>Command Key</label>
              <input type="text" value="${escapeHtml(commandKey)}" data-role="command-key">
            </div>
            <div class="field">
              <label>Chat Command</label>
              <input type="text" value="${escapeHtml(command.name || "")}" data-role="command-name">
            </div>
            <div class="field">
              <label>Description</label>
              <input type="text" value="${escapeHtml(command.description || "")}" data-role="command-description">
            </div>
            <div class="field">
              <label>Bit Cost</label>
              <input type="number" min="0" step="1" value="${escapeHtml(command.bitCost || "")}" placeholder="Optional exact cheer amount" data-role="command-bit-cost">
            </div>
          </div>
          <p class="section-note">Each action runs in order. Build a sequence by stacking keyboard, mouse, and scroll steps.</p>
          <p class="section-note">Usage: ${escapeHtml(buildCommandUsage(commandKey, command))}${hasArgumentPlaceholders(command) ? " (commands with chat arguments run immediately instead of entering the vote tally)" : ""}</p>
          <p class="section-note">${normalizeBitCost(command.bitCost) > 0 ? `Bit reward: cheer${normalizeBitCost(command.bitCost)}${escapeHtml(hasArgumentPlaceholders(command) ? " plus command args in the cheer message" : "")}.` : "Leave Bit Cost empty to keep this command chat-only/vote-only."}</p>
          <div class="command-actions">${actionsMarkup}</div>
          <div class="button-row" style="margin-top: 10px;">
            <button type="button" data-role="add-action">Add Action</button>
          </div>
        `;

        card.querySelector('[data-role="delete-command"]').addEventListener("click", () => {
          delete state.commands[gameKey][commandKey];
          state.selectedCommand = Object.keys(state.commands[gameKey] || {})[0] || null;
          renderCommandNav();
          renderSelectedGameEditor();
        });

        card.querySelector('[data-role="command-key"]').addEventListener("change", (event) => {
          const newKey = sanitizeKey(event.target.value);
          if (!newKey) {
            event.target.value = commandKey;
            return;
          }
          if (newKey !== commandKey && state.commands[gameKey][newKey]) {
            setMessage(`Command key "${newKey}" already exists in ${gameKey}.`, "warn");
            event.target.value = commandKey;
            return;
          }
          const updated = deepClone(state.commands[gameKey][commandKey]);
          delete state.commands[gameKey][commandKey];
          state.commands[gameKey][newKey] = updated;
          state.selectedCommand = newKey;
          renderCommandNav();
          renderSelectedGameEditor();
        });

        card.querySelector('[data-role="command-name"]').addEventListener("input", (event) => {
          state.commands[gameKey][commandKey].name = event.target.value;
        });

        card.querySelector('[data-role="command-description"]').addEventListener("input", (event) => {
          state.commands[gameKey][commandKey].description = event.target.value;
        });

        card.querySelector('[data-role="command-bit-cost"]').addEventListener("input", (event) => {
          const normalized = normalizeBitCost(event.target.value);
          if (normalized > 0) {
            state.commands[gameKey][commandKey].bitCost = normalized;
            return;
          }

          delete state.commands[gameKey][commandKey].bitCost;
        });

        card.querySelector('[data-role="add-action"]').addEventListener("click", () => {
          state.commands[gameKey][commandKey].actions.push("keytap|space|1");
          renderSelectedGameEditor();
        });

        card.querySelectorAll("[data-action-index]").forEach((row) => {
          const actionIndex = Number(row.dataset.actionIndex);

          const syncAction = () => {
            const type = row.querySelector('[data-role="action-type"]').value;
            const actionData = { type };
            row.querySelectorAll('[data-role="action-field"]').forEach((input) => {
              if (input.type === "checkbox") {
                actionData[input.dataset.field] = input.checked;
                return;
              }
              actionData[input.dataset.field] = input.value.trim();
            });
            const builtAction = buildAction(actionData);
            state.commands[gameKey][commandKey].actions[actionIndex] = builtAction;
            row.querySelector('[data-role="action-preview"]').textContent = builtAction;
          };

          row.querySelector('[data-role="action-type"]').addEventListener("change", (event) => {
            state.commands[gameKey][commandKey].actions[actionIndex] = buildAction({ type: event.target.value });
            renderSelectedGameEditor();
          });

          row.querySelectorAll('[data-role="action-field"]').forEach((input) => {
            input.addEventListener("input", syncAction);
          });

          row.querySelector('[data-role="remove-action"]').addEventListener("click", () => {
            state.commands[gameKey][commandKey].actions.splice(actionIndex, 1);
            renderSelectedGameEditor();
          });

          const pickMousePositionButton = row.querySelector('[data-role="pick-mouse-position"]');
          if (pickMousePositionButton) {
            pickMousePositionButton.addEventListener("click", async () => {
              setMessage("Left click inside the target game window to capture window-relative coordinates. Press Escape to cancel.", "ok");
              try {
                const result = await ipcRenderer.invoke("begin-coordinate-pick");
                if (!result || result.cancelled) {
                  setMessage("Coordinate capture cancelled.", "warn");
                  return;
                }

                const relative = await ipcRenderer.invoke("screen-to-game-coordinates", {
                  gameKey,
                  x: result.x,
                  y: result.y
                });

                const currentAction = parseAction(state.commands[gameKey][commandKey].actions[actionIndex]);
                if (currentAction.type === "mousedrag") {
                  state.commands[gameKey][commandKey].actions[actionIndex] = buildAction({
                    ...currentAction,
                    startX: String(relative.x),
                    startY: String(relative.y)
                  });
                } else {
                  state.commands[gameKey][commandKey].actions[actionIndex] = buildAction({
                    ...currentAction,
                    type: currentAction.type === "mousehold" ? "mousehold" : "mouse",
                    x: String(relative.x),
                    y: String(relative.y)
                  });
                }
                renderSelectedGameEditor();
                setMessage(`Captured relative position at ${relative.x}, ${relative.y} inside the game window.`, "ok");
              } catch (error) {
                setMessage(`Coordinate capture failed: ${error.message}`, "warn");
              }
            });
          }

          const useChatXYButton = row.querySelector('[data-role="use-chat-xy"]');
          if (useChatXYButton) {
            useChatXYButton.addEventListener("click", () => {
              const currentAction = parseAction(state.commands[gameKey][commandKey].actions[actionIndex]);
              if (currentAction.type === "mousedrag") {
                state.commands[gameKey][commandKey].actions[actionIndex] = buildAction({
                  ...currentAction,
                  startX: "$1",
                  startY: "$2",
                  endX: "$3",
                  endY: "$4"
                });
              } else {
                state.commands[gameKey][commandKey].actions[actionIndex] = buildAction({
                  ...currentAction,
                  type: currentAction.type === "mousehold" ? "mousehold" : "mouse",
                  x: "$1",
                  y: "$2"
                });
              }
              renderSelectedGameEditor();
              setMessage(`This action now uses chat-supplied coordinates. Usage: ${buildCommandUsage(commandKey, state.commands[gameKey][commandKey])}`, "ok");
            });
          }

          const testMousePositionButton = row.querySelector('[data-role="test-mouse-position"]');
          if (testMousePositionButton) {
            testMousePositionButton.addEventListener("click", async () => {
              const currentAction = parseAction(state.commands[gameKey][commandKey].actions[actionIndex]);
              try {
                if (currentAction.type === "mousedrag") {
                  if (!/^-?\d+$/.test(String(currentAction.startX)) || !/^-?\d+$/.test(String(currentAction.startY))) {
                    throw new Error("Test Position only works with numeric drag start X/Y values. Replace $1/$2 with numbers or use Pick Position.");
                  }
                  await ipcRenderer.invoke("test-mouse-action", {
                    gameKey,
                    x: currentAction.startX,
                    y: currentAction.startY,
                    button: "none"
                  });
                  setMessage(`Tested drag start position at ${currentAction.startX}, ${currentAction.startY} relative to the game window.`, "ok");
                  return;
                }

                if (!/^-?\d+$/.test(String(currentAction.x)) || !/^-?\d+$/.test(String(currentAction.y))) {
                  throw new Error("Test Position only works with numeric X/Y values. Replace $1/$2 with numbers or use Pick Position.");
                }
                await ipcRenderer.invoke("test-mouse-action", {
                  gameKey,
                  x: currentAction.x,
                  y: currentAction.y,
                  button: currentAction.button
                });
                setMessage(`Tested mouse action at ${currentAction.x}, ${currentAction.y} relative to the game window.`, "ok");
              } catch (error) {
                setMessage(`Mouse test failed: ${error.message}`, "warn");
              }
            });
          }
        });

        return card;
      }

      function renderSelectedGameEditor() {
        ensureSelectedGame();
        const gameKey = state.selectedGame;
        dom.commandsContainer.innerHTML = "";

        if (!gameKey) {
          dom.gamePageHeading.textContent = "Commands";
          dom.gameEditorTitle.textContent = "Command Editor";
          dom.gameEditorSubtitle.textContent = "Create a game to start building commands.";
          dom.selectedGameKey.value = "";
          dom.gameProcess.value = "";
          dom.gameTitle.value = "";
          renderDisplaySelect(dom.gameDisplay, "");
          renderRunningAppSelects();
          return;
        }

        const commands = state.commands[gameKey];
        dom.gamePageHeading.textContent = `Commands for ${gameKey}`;
        dom.gameEditorTitle.textContent = state.selectedCommand ? `Edit ${state.selectedCommand}` : "Command Editor";
        dom.gameEditorSubtitle.textContent = `${Object.keys(commands).length} configured commands`;
        dom.selectedGameKey.value = gameKey;
        const gameWindow = getWindowConfigForGame(gameKey) || {};
        dom.gameProcess.value = gameWindow.processName || "";
        dom.gameTitle.value = gameWindow.windowTitle || "";
        renderDisplaySelect(dom.gameDisplay, gameWindow.displayId || "");
        renderRunningAppSelects();

        if (!state.selectedCommand || !commands[state.selectedCommand]) {
          dom.commandsContainer.innerHTML = '<div class="empty">No commands yet. Add one above.</div>';
          return;
        }

        dom.commandsContainer.appendChild(createCommandCard(state.selectedCommand, commands[state.selectedCommand], gameKey));
      }

      function renderProcessSelect(selectElement, currentValue = "") {
        const options = ['<option value="">Select running app...</option>'];

        state.runningApps.forEach((appName) => {
          const selected = currentValue && appName.toLowerCase() === currentValue.toLowerCase()
            ? " selected"
            : "";
          options.push(`<option value="${escapeHtml(appName)}"${selected}>${escapeHtml(appName)}</option>`);
        });

        selectElement.innerHTML = options.join("");
      }

      function renderRunningAppSelects() {
        renderProcessSelect(dom.addGameProcessSelect, dom.addGameProcess.value.trim());
        renderProcessSelect(dom.gameProcessSelect, dom.gameProcess.value.trim());
      }

      function renderDisplaySelect(selectElement, currentValue = "") {
        const options = ['<option value="">Use target window bounds</option>'];

        state.displays.forEach((display) => {
          const selected = currentValue && display.id === currentValue ? " selected" : "";
          options.push(`<option value="${escapeHtml(display.id)}"${selected}>${escapeHtml(display.label)}</option>`);
        });

        selectElement.innerHTML = options.join("");
      }

      function renderAll() {
        renderProcessStatus();
        renderLogTabs();
        renderNav();
        renderPages();
        renderSettings();
        renderCommandNav();
        renderSelectedGameEditor();
      }

      async function refreshWindowStatus() {
        try {
          state.targetWindow = await ipcRenderer.invoke("get-window-status");
          renderProcessStatus();
        } catch (error) {
          state.targetWindow = {
            active: false,
            label: "Target Unknown",
            reason: error.message
          };
          renderProcessStatus();
        }
      }

      async function refreshRunningApps(showMessage = false) {
        try {
          state.runningApps = await ipcRenderer.invoke("get-process-list");
          renderRunningAppSelects();
          if (showMessage) {
            setMessage(`Loaded ${state.runningApps.length} running apps.`, "ok");
          }
        } catch (error) {
          if (showMessage) {
            setMessage(`Running app refresh failed: ${error.message}`, "warn");
          }
        }
      }

      async function refreshDisplays(showMessage = false) {
        try {
          state.displays = await ipcRenderer.invoke("get-display-list");
          renderDisplaySelect(dom.addGameDisplay, dom.addGameDisplay.value);
          renderDisplaySelect(dom.gameDisplay, getWindowConfigForGame(state.selectedGame)?.displayId || "");
          if (showMessage) {
            setMessage(`Loaded ${state.displays.length} displays.`, "ok");
          }
        } catch (error) {
          if (showMessage) {
            setMessage(`Display refresh failed: ${error.message}`, "warn");
          }
        }
      }

      function getSelectedDisplayDetails(selectElement) {
        const displayId = selectElement.value || "";
        if (!displayId) {
          return {
            displayId: "",
            displayLabel: "",
            displayBounds: null
          };
        }

        const match = state.displays.find((display) => display.id === displayId);
        return {
          displayId,
          displayLabel: match?.label || "",
          displayBounds: match ? deepClone(match.bounds) : null
        };
      }

      function useSelectedProcess(selectElement, processInput, titleInput) {
        const selected = selectElement.value;
        if (!selected) {
          setMessage("Select a running app first.", "warn");
          return;
        }

        processInput.value = selected;
        if (!titleInput.value.trim()) {
          titleInput.value = selected.replace(/\.exe$/i, "");
        }
      }

      function collectConfigFromForm() {
        state.config.username = dom.username.value.trim();
        state.config.channel = normalizeChannel(dom.channel.value);
        state.config.trigger = dom.trigger.value || "!";
        state.config.tL = Number(dom.voteLength.value) || 15;
        state.config.bitRewards = dom.bitRewards.value === "true";
        state.config.recentCommandCount = Math.max(1, Math.min(50, Number(dom.recentCommandCount.value) || 10));
        state.config.game = dom.activeGame.value || state.selectedGame || "";
        state.config.gameWindows = state.config.gameWindows || {};
        const displayDetails = getSelectedDisplayDetails(dom.gameDisplay);
        const gameWindow = {
          processName: dom.gameProcess.value.trim(),
          windowTitle: dom.gameTitle.value.trim(),
          displayId: displayDetails.displayId,
          displayLabel: displayDetails.displayLabel,
          displayBounds: displayDetails.displayBounds
        };
        if (state.selectedGame) {
          state.config.gameWindows[state.selectedGame] = gameWindow;
        }
        state.config.gameWindow = gameWindow;
      }

      async function loadState(message = "Configuration loaded.") {
        const appState = await ipcRenderer.invoke("get-app-state");
        state.config = appState.config;
        state.config.gameWindows = state.config.gameWindows || {};
        state.commands = appState.commands;
        state.process = appState.process;
        ensureSelectedGame();
        renderAll();
        await refreshRunningApps();
        await refreshDisplays();
        await refreshWindowStatus();
        setMessage(message, "ok");
      }

      async function saveState() {
        collectConfigFromForm();
        const savedState = await ipcRenderer.invoke("save-app-state", {
          config: state.config,
          commands: state.commands
        });
        state.config = savedState.config;
        state.commands = savedState.commands;
        state.process = savedState.process;
        ensureSelectedGame();
        renderAll();
        await refreshWindowStatus();
        setMessage("Saved config.json and commands.json.", "ok");
      }

      async function beginOAuthFlow(reason = "Starting Twitch authorization...") {
        collectConfigFromForm();
        await ipcRenderer.invoke("save-app-state", {
          config: state.config,
          commands: state.commands
        });

        setMessage(reason, "ok");
        await ipcRenderer.invoke("begin-twitch-auth");
        return true;
      }

      function addGame() {
        const gameKey = sanitizeKey(dom.addGameKey.value);
        if (!gameKey) {
          setMessage("Enter a game key before adding a game.", "warn");
          return;
        }
        if (state.commands[gameKey]) {
          setMessage(`Game "${gameKey}" already exists.`, "warn");
          return;
        }

        state.commands[gameKey] = {};
        state.selectedGame = gameKey;
        state.selectedCommand = null;
        dom.addGameKey.value = "";
        if (!state.config.game) {
          state.config.game = gameKey;
        }
        state.config.gameWindows = state.config.gameWindows || {};
        state.config.gameWindows[gameKey] = {
          processName: dom.addGameProcess.value.trim(),
          windowTitle: dom.addGameTitle.value.trim(),
          ...getSelectedDisplayDetails(dom.addGameDisplay)
        };
        dom.addGameProcess.value = "";
        dom.addGameTitle.value = "";
        dom.addGameDisplay.value = "";
        state.page = "game";
        renderAll();
        setMessage(`Created game "${gameKey}".`, "ok");
      }

      function duplicateGame() {
        const sourceKey = state.selectedGame;
        const targetKey = sanitizeKey(window.prompt("Duplicate game as:", `${sourceKey}_copy`) || "");
        if (!sourceKey) {
          setMessage("Select a game first.", "warn");
          return;
        }
        if (!targetKey) {
          return;
        }
        if (state.commands[targetKey]) {
          setMessage(`Game "${targetKey}" already exists.`, "warn");
          return;
        }

        state.commands[targetKey] = deepClone(state.commands[sourceKey]);
        state.config.gameWindows = state.config.gameWindows || {};
        state.config.gameWindows[targetKey] = deepClone(getWindowConfigForGame(sourceKey) || { processName: "", windowTitle: "" });
        state.selectedGame = targetKey;
        state.selectedCommand = Object.keys(state.commands[targetKey])[0] || null;
        state.page = "game";
        renderAll();
        setMessage(`Duplicated "${sourceKey}" to "${targetKey}".`, "ok");
      }

      function deleteGame() {
        const gameKey = state.selectedGame;
        if (!gameKey) {
          return;
        }

        delete state.commands[gameKey];
        if (state.config.gameWindows) {
          delete state.config.gameWindows[gameKey];
        }
        const remaining = Object.keys(state.commands);
        state.selectedGame = remaining[0] || null;
        if (state.config.game === gameKey) {
          state.config.game = state.selectedGame || "";
        }
        state.page = state.selectedGame ? "game" : "main";
        renderAll();
        setMessage(`Deleted game "${gameKey}".`, "ok");
      }

      function renameSelectedGame() {
        const currentKey = state.selectedGame;
        const newKey = sanitizeKey(dom.selectedGameKey.value);
        if (!currentKey || !newKey || newKey === currentKey) {
          dom.selectedGameKey.value = currentKey || "";
          return;
        }
        if (state.commands[newKey]) {
          setMessage(`Game "${newKey}" already exists.`, "warn");
          dom.selectedGameKey.value = currentKey;
          return;
        }

        state.commands[newKey] = state.commands[currentKey];
        delete state.commands[currentKey];
        state.config.gameWindows = state.config.gameWindows || {};
        state.config.gameWindows[newKey] = getWindowConfigForGame(currentKey) || { processName: "", windowTitle: "" };
        delete state.config.gameWindows[currentKey];
        state.selectedGame = newKey;
        if (state.config.game === currentKey) {
          state.config.game = newKey;
        }
        renderAll();
        setMessage(`Renamed game "${currentKey}" to "${newKey}".`, "ok");
      }

      function addCommand() {
        const gameKey = state.selectedGame;
        const commandKey = sanitizeKey(dom.newCommandKey.value);
        if (!gameKey) {
          setMessage("Create a game first.", "warn");
          return;
        }
        if (!commandKey) {
          setMessage("Enter a command key before adding a command.", "warn");
          return;
        }
        if (state.commands[gameKey][commandKey]) {
          setMessage(`Command "${commandKey}" already exists in ${gameKey}.`, "warn");
          return;
        }

        state.commands[gameKey][commandKey] = {
          name: commandKey,
          description: "Describe this command",
          bitCost: "",
          actions: ["keytap|space|1"]
        };
        dom.newCommandKey.value = "";
        state.selectedCommand = commandKey;
        renderSelectedGameEditor();
        renderCommandNav();
        setMessage(`Added command "${commandKey}" to ${gameKey}.`, "ok");
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function startBot() {
        if (!hasUsableOAuth()) {
          state.pendingStartAfterAuth = true;
          beginOAuthFlow("OAuth is missing or invalid. Starting Twitch authorization first.").catch((error) => {
            state.pendingStartAfterAuth = false;
            setMessage(`Authorization failed: ${error.message}`, "warn");
          });
          return false;
        }
        ipcRenderer.send("start-node-process");
        return true;
      }

      function stopBot() {
        ipcRenderer.send("stop-node-process");
      }

      function saveApp() {
        saveState().catch((error) => {
          setMessage(`Save failed: ${error.message}`, "warn");
        });
      }

      dom.startButton.addEventListener("click", startBot);
      dom.homeStartButton.addEventListener("click", startBot);

      dom.username.addEventListener("input", () => {
        const username = dom.username.value.trim();
        const currentChannel = normalizeChannel(dom.channel.value);
        const priorUsernameChannel = normalizeChannel(state.config?.username || "");

        if (!dom.channel.value.trim() || currentChannel === priorUsernameChannel) {
          dom.channel.value = normalizeChannel(username);
        }
      });

      dom.oauthButton.addEventListener("click", () => {
        beginOAuthFlow().catch((error) => {
          setMessage(`Authorization failed: ${error.message}`, "warn");
        });
      });

      dom.testRecentCommandButton.addEventListener("click", () => {
        ipcRenderer.invoke("test-recent-command").then(() => {
          setMessage("Added a test recent-command entry for the browser source.", "ok");
        }).catch((error) => {
          setMessage(`Recent command test failed: ${error.message}`, "warn");
        });
      });

      dom.clearRecentCommandsButton.addEventListener("click", () => {
        ipcRenderer.invoke("clear-recent-commands").then(() => {
          setMessage("Cleared recent-command entries.", "ok");
        }).catch((error) => {
          setMessage(`Failed to clear recent commands: ${error.message}`, "warn");
        });
      });

      dom.copyOauthButton.addEventListener("click", () => {
        ipcRenderer.invoke("copy-oauth-token").then(() => {
          setMessage("OAuth token copied to clipboard.", "ok");
        }).catch((error) => {
          setMessage(`Copy failed: ${error.message}`, "warn");
        });
      });

      dom.stopButton.addEventListener("click", stopBot);
      dom.homeStopButton.addEventListener("click", stopBot);

      dom.updateCommandListButton.addEventListener("click", () => {
        collectConfigFromForm();
        ipcRenderer.invoke("save-app-state", {
          config: state.config,
          commands: state.commands
        }).then(() => {
          return ipcRenderer.invoke("update-command-list");
        }).then((result) => {
          setMessage(`Command list written to ${result.outputPath}.`, "ok");
        }).catch((error) => {
          setMessage(`Command list update failed: ${error.message}`, "warn");
        });
      });

      dom.updateCommandListButtonSettings.addEventListener("click", () => {
        dom.updateCommandListButton.click();
      });

      dom.botLogsTab.addEventListener("click", () => {
        state.activeLogTab = "bot";
        renderLogTabs();
      });

      dom.errorLogsTab.addEventListener("click", () => {
        state.activeLogTab = "error";
        renderLogTabs();
      });

      dom.saveButton.addEventListener("click", saveApp);
      dom.homeSaveButton.addEventListener("click", saveApp);

      dom.reloadButton.addEventListener("click", () => {
        loadState("Reloaded configuration from disk.").catch((error) => {
          setMessage(`Reload failed: ${error.message}`, "warn");
        });
      });

      dom.navMainButton.addEventListener("click", () => {
        navigateTo("main");
      });

      dom.navSettingsButton.addEventListener("click", () => {
        navigateTo("settings");
      });

      dom.gamesMenuButton.addEventListener("click", () => {
        state.gamesMenuOpen = !state.gamesMenuOpen;
        renderNav();
      });

      dom.exitButton.addEventListener("click", () => {
        ipcRenderer.send("exit-app");
      });

      document.addEventListener("click", (event) => {
        if (!event.target.closest(".menu-wrap")) {
          if (state.gamesMenuOpen) {
            state.gamesMenuOpen = false;
            renderNav();
          }
        }
      });

      dom.createGameButton.addEventListener("click", addGame);
      dom.duplicateGameButton.addEventListener("click", duplicateGame);
      dom.deleteGameButton.addEventListener("click", deleteGame);
      dom.addCommandButton.addEventListener("click", addCommand);
      dom.selectedGameKey.addEventListener("change", renameSelectedGame);

      dom.activeGame.addEventListener("change", () => {
        state.config.game = dom.activeGame.value;
        if (state.commands[state.config.game]) {
          state.selectedGame = state.config.game;
          state.selectedCommand = Object.keys(state.commands[state.selectedGame] || {})[0] || null;
          renderSettings();
          renderCommandNav();
          renderSelectedGameEditor();
        }
      });

      dom.gameProcess.addEventListener("input", () => {
        if (!state.selectedGame) {
          return;
        }
        state.config.gameWindows = state.config.gameWindows || {};
        state.config.gameWindows[state.selectedGame] = state.config.gameWindows[state.selectedGame] || {};
        state.config.gameWindows[state.selectedGame].processName = dom.gameProcess.value;
      });

      dom.gameTitle.addEventListener("input", () => {
        if (!state.selectedGame) {
          return;
        }
        state.config.gameWindows = state.config.gameWindows || {};
        state.config.gameWindows[state.selectedGame] = state.config.gameWindows[state.selectedGame] || {};
        state.config.gameWindows[state.selectedGame].windowTitle = dom.gameTitle.value;
      });

      dom.gameDisplay.addEventListener("change", () => {
        if (!state.selectedGame) {
          return;
        }
        state.config.gameWindows = state.config.gameWindows || {};
        state.config.gameWindows[state.selectedGame] = state.config.gameWindows[state.selectedGame] || {};
        Object.assign(state.config.gameWindows[state.selectedGame], getSelectedDisplayDetails(dom.gameDisplay));
      });

      dom.useAddGameProcessButton.addEventListener("click", () => {
        useSelectedProcess(dom.addGameProcessSelect, dom.addGameProcess, dom.addGameTitle);
      });

      dom.useGameProcessButton.addEventListener("click", () => {
        useSelectedProcess(dom.gameProcessSelect, dom.gameProcess, dom.gameTitle);
        if (state.selectedGame) {
          state.config.gameWindows = state.config.gameWindows || {};
          state.config.gameWindows[state.selectedGame] = state.config.gameWindows[state.selectedGame] || {};
          state.config.gameWindows[state.selectedGame].processName = dom.gameProcess.value;
          if (!state.config.gameWindows[state.selectedGame].windowTitle) {
            state.config.gameWindows[state.selectedGame].windowTitle = dom.gameTitle.value;
          }
        }
      });

      dom.refreshAddGameProcessesButton.addEventListener("click", () => {
        refreshRunningApps(true);
        refreshDisplays();
      });

      dom.refreshGameProcessesButton.addEventListener("click", () => {
        refreshRunningApps(true);
        refreshDisplays();
      });

      ipcRenderer.on("process-status", (event, processState) => {
        state.process = processState;
        renderProcessStatus();
      });

      ipcRenderer.on("node-process-stdout", (event, data) => {
        dom.logs.textContent += data;
        dom.logs.scrollTop = dom.logs.scrollHeight;
      });

      ipcRenderer.on("node-process-stderr", (event, data) => {
        dom.errors.textContent += data;
        dom.errors.scrollTop = dom.errors.scrollHeight;
        if (data.trim()) {
          state.activeLogTab = "error";
          renderLogTabs();
        }
      });

      ipcRenderer.on("node-process-exit", () => {
        setMessage("Bot process exited.", "warn");
      });

      ipcRenderer.on("oauth-status", async (event, payload) => {
        if (payload.kind === "started") {
          setMessage(`Authorize in the browser with code ${payload.userCode}.`, "ok");
          return;
        }

        if (payload.kind === "success") {
          await loadState("Twitch authorization complete.");
          if (state.pendingStartAfterAuth) {
            state.pendingStartAfterAuth = false;
            ipcRenderer.send("start-node-process");
          }
          return;
        }

        if (payload.kind === "failed") {
          state.pendingStartAfterAuth = false;
          setMessage(`Authorization failed: ${payload.message}`, "warn");
        }
      });

      loadState().catch((error) => {
        setMessage(`Initial load failed: ${error.message}`, "warn");
      });

      setInterval(() => {
        refreshWindowStatus();
      }, 2000);
    

