// The Required node modules
const tmi = require('tmi.js');
const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadRuntime } = require("../shared/runtime-loader");
const { mouse, keyboard, Button, Key } = loadRuntime("@nut-tree/nut-js");
const { ensureDataFiles } = require("../shared/data-paths");
const {
	appendRecentCommand,
	createRecentCommandEntry,
	ensureRecentCommandFeedFile,
	readRecentCommandFeed
} = require("../shared/recent-command-feed");
const {
	buildArgumentSuffix,
	buildCommandUsage: buildUsageString,
	hasArgumentPlaceholders,
	getRequiredArgumentCount
} = require("../shared/command-usage");
const {
	getTargetWindowStatus,
	prepareTargetWindow,
	restorePreviousWindow
} = require("../shared/window-control");
const dataDir = ensureDataFiles(__dirname);
const configPath = path.join(dataDir, "config.json");
const commandsPath = path.join(dataDir, "commands.json");
const commandListPath = path.join(dataDir, "CommandList.txt");
const recentCommandsPath = path.join(dataDir, "RecentCommands.json");
const RECENT_COMMAND_SERVER_PORT = 2003;
let config = readJson(configPath);
let commands = readJson(commandsPath);

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeConfig() {
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function buildVoteMetadataState(factory) {
	const state = {};
	for (const gameKey in commands) {
		const subCommands = commands[gameKey];
		state[gameKey] = {};
		for (const subCommand in subCommands) {
			state[gameKey][subCommand] = factory(gameKey, subCommand);
		}
	}
	return state;
}

// Define the Vote Dictionary
let voteDict = {};
for (const command in commands) {
	const subCommands = commands[command];
	voteDict[command] = {"null": 0};
	for (const subCommand in subCommands) {
		voteDict[command][subCommand] = 0;
	}
}
// Define the Vote Actions
let voteActions = commands;
// Define the array of possible choices
let voteChoices = {};
for (const command in commands) {
  const subCommands = commands[command];
  voteChoices[command] = Object.keys(subCommands);
}
let voteFirstActors = buildVoteMetadataState(() => null);

// Setting variables
let timeoutId = null;
let running = true;
let lastWindowWarning = "";
let activeAutomationSession = null;
const heldKeys = new Set();
const heldMouseButtons = new Set();
let lifecycleOnlineAnnounced = false;
let lifecycleShutdownStarted = false;
let recentCommandServer = null;
let recentCommandWatcher = null;
const recentCommandSseClients = new Set();

class AutomationCancelledError extends Error {
	constructor(message = "Automation cancelled.") {
		super(message);
		this.name = "AutomationCancelledError";
	}
}

function hasUsableOAuth() {
	return typeof config.oauth === "string" &&
		config.oauth.startsWith("oauth:") &&
		config.oauth.length > "oauth:".length;
}

function getRecentCommandLimit() {
	const parsed = Number(config.recentCommandCount);
	if (!Number.isFinite(parsed)) {
		return 10;
	}

	return Math.max(1, Math.min(50, Math.floor(parsed)));
}

function logOAuthHelp(reason) {
	console.error(`Twitch OAuth problem: ${reason}`);
	console.error("Open the GUI, click 'Get OAuth Token', sign in as the bot account, then paste the token in oauth:... format and save.");
}

async function safeSay(targetChannel, message) {
	try {
		await client.say(targetChannel, message);
		return true;
	} catch (_) {
		return false;
	}
}

async function announceShutdownAndExit(signal) {
	if (lifecycleShutdownStarted) {
		return;
	}

	lifecycleShutdownStarted = true;
	try {
		if (recentCommandWatcher) {
			recentCommandWatcher.close();
			recentCommandWatcher = null;
		}
		if (recentCommandServer) {
			for (const response of Array.from(recentCommandSseClients)) {
				try {
					response.end();
				} catch (_) {
					// Ignore shutdown stream errors.
				}
			}
			recentCommandSseClients.clear();
			await new Promise((resolve) => recentCommandServer.close(() => resolve()));
			recentCommandServer = null;
		}
		if (hasUsableOAuth() && config.channel) {
			await safeSay(config.channel, "TwitchCommander is now offline.");
			await sleep(250);
		}
	} finally {
		try {
			await client.disconnect();
		} catch (_) {
			// Ignore disconnect errors during shutdown.
		}
		process.exit(0);
	}
}

function resetVoteState() {
	for (const dict in voteDict[config.game]) {
		voteDict[config.game][dict] = 0;
	}
	for (const commandKey in voteFirstActors[config.game]) {
		voteFirstActors[config.game][commandKey] = null;
	}
}

function clearPendingVoteTimeout() {
	if (timeoutId !== null) {
		clearTimeout(timeoutId);
		timeoutId = null;
	}
}

function createAutomationSession(contextLabel) {
	const session = {
		contextLabel,
		cancelRequested: false
	};
	activeAutomationSession = session;
	return session;
}

function ensureNotCancelled(session) {
	if (session?.cancelRequested) {
		throw new AutomationCancelledError(`Automation cancelled for ${session.contextLabel}.`);
	}
}

async function cancellableSleep(ms, session) {
	const numericDuration = Math.max(0, Number(ms) || 0);
	const startedAt = Date.now();
	while (Date.now() - startedAt < numericDuration) {
		ensureNotCancelled(session);
		const remaining = numericDuration - (Date.now() - startedAt);
		await sleep(Math.min(50, remaining));
	}
	ensureNotCancelled(session);
}

async function releaseHeldInputs() {
	for (const button of Array.from(heldMouseButtons)) {
		try {
			await mouse.releaseButton(button);
		} catch (_) {
			// Ignore release failures during cancellation cleanup.
		} finally {
			heldMouseButtons.delete(button);
		}
	}

	for (const key of Array.from(heldKeys)) {
		try {
			await keyboard.releaseKey(key);
		} catch (_) {
			// Ignore release failures during cancellation cleanup.
		} finally {
			heldKeys.delete(key);
		}
	}
}

async function cancelActiveAutomation(reason = "cancel requested") {
	const session = activeAutomationSession;
	if (!session) {
		return false;
	}

	session.cancelRequested = true;
	await releaseHeldInputs();
	console.log(`Automation cancellation requested: ${reason}.`);
	return true;
}

function getRecentCommandsSnapshot() {
	return readRecentCommandFeed(recentCommandsPath).slice(-getRecentCommandLimit());
}

function buildRecentCommandsPage() {
	return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>TwitchCommander Recent Commands</title>
    <style>
      :root {
        --bg: #081019;
        --panel: rgba(10, 18, 28, 0.84);
        --line: rgba(101, 196, 255, 0.2);
        --text: #ecf6ff;
        --muted: #8ca4b8;
        --accent: #6ce3ff;
      }

      * {
        box-sizing: border-box;
      }

      html {
        background: #00ff00;
      }

      body {
        margin: 0;
		padding: 0;
        min-height: 100vh;
        background: #00ff00;
        color: var(--text);
        font-family: "Segoe UI", sans-serif;
        overflow: hidden;
      }

      .shell {
        min-height: 100vh;
        padding: 5px;
        display: grid;
        align-content: start;
        background: #00ff00;
      }

      .panel {
        width: min(720px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 18px 10px 20px;
        backdrop-filter: blur(16px);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
      }

      .title {
        margin: 0 0 4px;
        font-size: 14px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--accent);
      }

      .subtitle {
        margin: 0 0 16px;
        color: var(--muted);
        font-size: 13px;
      }

      .feed {
        display: flex;
        flex-direction: column;
        gap: 26px;
      }

      .entry {
        position: relative;
        padding: 0;
        transform-origin: top center;
        overflow: visible;
        will-change: transform, opacity, max-height;
        --entry-accent: #6ce3ff;
        --entry-border: rgba(108, 227, 255, 0.24);
        --entry-badge-border: rgba(108, 227, 255, 0.32);
        --entry-body-bg: rgba(9, 18, 28, 0.94);
        --entry-body-bg-2: rgba(15, 27, 38, 0.96);
        --entry-text: #d3e9fb;
      }

      .entry[data-source="bit"] {
        --entry-accent: #b187ff;
        --entry-border: rgba(177, 135, 255, 0.28);
        --entry-badge-border: rgba(177, 135, 255, 0.38);
        --entry-body-bg: rgba(24, 14, 39, 0.95);
        --entry-body-bg-2: rgba(35, 20, 54, 0.97);
        --entry-text: #efe5ff;
      }

      .entry[data-source="immediate"] {
        --entry-accent: #ffb85c;
        --entry-border: rgba(255, 184, 92, 0.28);
        --entry-badge-border: rgba(255, 184, 92, 0.38);
        --entry-body-bg: rgba(37, 23, 9, 0.95);
        --entry-body-bg-2: rgba(53, 33, 12, 0.97);
        --entry-text: #fff1db;
      }

      .entry.fade {
        animation: fadein 380ms ease both;
      }

      .entry.entering {
        opacity: 0;
        transform: scale(0.7);
        max-height: 0;
      }

      .entry.entering-active {
        opacity: 1;
        transform: scale(1);
        max-height: 220px;
        transition:
          max-height 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 520ms ease,
          transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }

      .entry.exiting {
        opacity: 0;
        transform: scale(0.7);
        max-height: 0;
        transition:
          max-height 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 520ms ease,
          transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }

      .entry-body {
        position: relative;
        padding: 16px 5px 18px;
        border-radius: 18px;
        border: 1px solid var(--entry-border);
        background:
          linear-gradient(180deg, var(--entry-body-bg-2), var(--entry-body-bg)),
          var(--entry-body-bg);
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.24);
        overflow: hidden;
        min-height: 58px;
      }

      .entry-user,
      .entry-time {
        position: absolute;
        z-index: 2;
        color: var(--entry-accent);
        font-family: "Consolas", "Courier New", monospace;
        font-size: 13px;
        background: rgba(8, 16, 25, 0.94);
        border: 1px solid var(--entry-badge-border);
        border-radius: 999px;
        padding: 3px 10px 4px;
        line-height: 1.2;
        box-shadow: 0 10px 18px rgba(0, 0, 0, 0.22);
      }

      .entry-user {
        top: -10px;
        left: 12px;
      }

      .entry-time {
        right: 12px;
        bottom: -10px;
      }

      .entry-command {
        margin: 0;
        color: var(--entry-text);
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Consolas", "Courier New", monospace;
        padding: 4px 10px 2px 12px;
      }

      .empty {
        color: var(--muted);
        padding: 12px 2px;
      }

      @keyframes fadein {
        from {
          opacity: 0.2;
        }
        to {
          opacity: 1;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel">
        <h1 class="title">Recent Commands</h1>
        <p class="subtitle">Live TwitchCommander activity feed</p>
        <div id="feed" class="feed"></div>
      </div>
    </div>
    <script>
      const feed = document.getElementById("feed");
      let previousSignature = "";
      const EXIT_MS = 520;
      const ENTER_MS = 520;

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function signature(entries) {
        return JSON.stringify(entries || []);
      }

      function createEntryNode(entry, className = "") {
        const wrapper = document.createElement("div");
        wrapper.className = \`entry \${className}\`.trim();
        wrapper.dataset.entryId = entry.id;
        wrapper.dataset.source = String(entry.source || "vote");
        wrapper.innerHTML = \`
          <div class="entry-user">[ \${escapeHtml(entry.username)} ]</div>
          <div class="entry-body">
            <pre class="entry-command">\${escapeHtml(entry.command)}</pre>
          </div>
          <div class="entry-time">[ \${escapeHtml(entry.timestamp || "")} ]</div>
        \`;
        return wrapper;
      }

      function render(entries) {
        const currentEntries = Array.isArray(entries) ? entries : [];
        const nextSignature = signature(currentEntries);
        const existingNodes = Array.from(feed.querySelectorAll("[data-entry-id]"));

        if (!currentEntries.length) {
          previousSignature = nextSignature;
          feed.innerHTML = '<div class="empty">No recent commands yet.</div>';
          return;
        }

        if (!previousSignature) {
          previousSignature = nextSignature;
          feed.innerHTML = "";
          currentEntries.forEach((entry, index) => {
            feed.appendChild(createEntryNode(entry, index === currentEntries.length - 1 ? "fade" : "fade"));
          });
          return;
        }

        if (nextSignature === previousSignature) {
          return;
        }

        feed.querySelector(".empty")?.remove();

        const currentIds = new Set(currentEntries.map((entry) => entry.id));
        const nodeMap = new Map(existingNodes.map((node) => [node.dataset.entryId, node]));
        const removedNodes = existingNodes.filter((node) => !currentIds.has(node.dataset.entryId) && !node.classList.contains("exiting"));
        const addedEntries = currentEntries.filter((entry) => !nodeMap.has(entry.id));
        const survivorEntries = currentEntries.filter((entry) => nodeMap.has(entry.id));

        if (!removedNodes.length && !addedEntries.length) {
          previousSignature = nextSignature;
          return;
        }

        removedNodes.forEach((node) => {
          const height = node.getBoundingClientRect().height;
          node.style.maxHeight = \`\${height}px\`;
          requestAnimationFrame(() => {
            node.classList.add("exiting");
          });
        });

        const finalizeRender = () => {
          removedNodes.forEach((node) => {
            if (node.parentElement) {
              node.remove();
            }
          });

          survivorEntries.forEach((entry) => {
            const node = nodeMap.get(entry.id);
            if (node && node.parentElement) {
              feed.appendChild(node);
            }
          });

          const insertNewEntries = () => {
            if (!addedEntries.length) {
              previousSignature = nextSignature;
              return;
            }

            const addedNodes = addedEntries.map((entry) => {
              const node = createEntryNode(entry, "entering");
              feed.appendChild(node);
              return node;
            });

            requestAnimationFrame(() => {
              addedNodes.forEach((node) => {
                void node.offsetHeight;
                node.classList.add("entering-active");
              });

              setTimeout(() => {
                addedNodes.forEach((node) => {
                  node.classList.remove("entering");
                  node.classList.remove("entering-active");
                });
                previousSignature = nextSignature;
              }, ENTER_MS);
            });
          };

          requestAnimationFrame(insertNewEntries);
        };

        setTimeout(finalizeRender, removedNodes.length ? EXIT_MS : 0);
      }

      fetch("/api/recent-commands", { cache: "no-store" })
        .then((response) => response.json())
        .then(render)
        .catch(() => render([]));

      const events = new EventSource("/events");
      events.onmessage = (event) => {
        try {
          render(JSON.parse(event.data));
        } catch (_) {
          // Ignore malformed payloads.
        }
      };
    </script>
  </body>
</html>`;
}

function broadcastRecentCommands() {
	const payload = `data: ${JSON.stringify(getRecentCommandsSnapshot())}\n\n`;
	for (const response of Array.from(recentCommandSseClients)) {
		try {
			response.write(payload);
		} catch (_) {
			recentCommandSseClients.delete(response);
		}
	}
}

function ensureRecentCommandWatcher() {
	if (recentCommandWatcher) {
		return;
	}

	let debounceId = null;
	const emit = () => {
		if (debounceId) {
			clearTimeout(debounceId);
		}
		debounceId = setTimeout(() => {
			broadcastRecentCommands();
		}, 30);
	};

	try {
		ensureRecentCommandFeedFile(recentCommandsPath);
		recentCommandWatcher = fs.watch(recentCommandsPath, emit);
	} catch (error) {
		console.error(`Recent command watcher failed: ${error.message}`);
	}
}

function ensureRecentCommandServer() {
	if (recentCommandServer) {
		return;
	}

	recentCommandServer = http.createServer((request, response) => {
		const url = new URL(request.url || "/", `http://127.0.0.1:${RECENT_COMMAND_SERVER_PORT}`);

		if (url.pathname === "/api/recent-commands") {
			response.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store"
			});
			response.end(JSON.stringify(getRecentCommandsSnapshot()));
			return;
		}

		if (url.pathname === "/events") {
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				Connection: "keep-alive"
			});
			recentCommandSseClients.add(response);
			response.write(`data: ${JSON.stringify(getRecentCommandsSnapshot())}\n\n`);
			request.on("close", () => {
				recentCommandSseClients.delete(response);
			});
			return;
		}

		if (url.pathname === "/") {
			response.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store"
			});
			response.end(buildRecentCommandsPage());
			return;
		}

		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Not found");
	});

	recentCommandServer.on("error", (error) => {
		console.error(`Recent command web server error on port ${RECENT_COMMAND_SERVER_PORT}: ${error.message}`);
	});

	recentCommandServer.listen(RECENT_COMMAND_SERVER_PORT, "127.0.0.1", () => {
		console.log(`Recent command web server listening on http://127.0.0.1:${RECENT_COMMAND_SERVER_PORT}`);
	});
	ensureRecentCommandWatcher();
}

function recordRecentCommand(username, commandText, source = "vote") {
	appendRecentCommand(
		recentCommandsPath,
		createRecentCommandEntry(username, commandText, source),
		getRecentCommandLimit()
	);
	broadcastRecentCommands();
}

function buildExecutedCommandText(commandKey, commandDetails, args = []) {
	const commandName = config.trigger + getCommandChatName(commandKey, commandDetails);
	return [commandName, ...args.filter((arg) => String(arg || "").trim())].join(" ");
}

updateCommandListFile(voteActions[config.game]);
ensureRecentCommandFeedFile(recentCommandsPath);
ensureRecentCommandServer();

// Setup connection configurations
// These include the channel, username and password
const client = new tmi.Client({
	options: { debug: false, messagesLogLevel: "info" },
	connection: {
		reconnect: true,
		secure: true
	},
	
	// Lack of the identity tags makes the bot anonymous and able to fetch messages from the channel
	// for reading, supervision, or viewing purposes only
	identity: {
		username: `${config.username}`,
		password: `${config.oauth}`
	},

	// Lack of the identity tags makes the bot anonymous and able to fetch messages from the channel
	// for reading, supervision, or viewing purposes only
	channels: [`${config.channel}`]
});

// Connect to the channel specified using the setings found in the configurations
// Any error found shall be logged out in the console
if (!hasUsableOAuth()) {
	logOAuthHelp("missing or invalid OAuth token");
} else {
	client.connect().catch((error) => {
		const message = String(error);
		if (message.toLowerCase().includes("authentication failed") || message.toLowerCase().includes("login")) {
			logOAuthHelp(message);
			running = false;
			return;
		}

		console.error(`Failed to connect to Twitch: ${message}`);
	});
}

// Check that the bot is connecting
client.on("connecting", (address, port) => {
	console.log(`Connecting to ${config.channel}.`);
});

// Check that the bot has connected
client.on("connected", (address, port) => {
	console.log(`Connected to ${config.channel}.`);
	if (!lifecycleOnlineAnnounced && hasUsableOAuth() && config.channel) {
		lifecycleOnlineAnnounced = true;
		safeSay(config.channel, "TwitchCommander is now online.");
	}
});

// Check that the bot has joined your channel
client.on("join", (channel, username, self) => {
	if(self){
		console.log(`I\'ve joined ${channel}.`);
	}
});

// Check that the bot has disconnected and give the reason
client.on("disconnected", (reason) => {
	console.log(`Disconnected due to ${reason}.`);
});

// Check that the bot has reconnected
client.on("reconnect", () => {
	console.log(`Connection re-established.`);
});

process.once("SIGTERM", () => {
	announceShutdownAndExit("SIGTERM");
});

process.once("SIGINT", () => {
	announceShutdownAndExit("SIGINT");
});

// We shall pass the parameters which shall be required
client.on('message', async (channel, tags, message, self) => {
	// debug Code
	//console.log(voteDict);
	//console.log(voteDict[config.game]);
	
	// Convert message to lowercase
	message = message.toLowerCase().trim();
	
	// Checks if User is either Streamer or Mod
	let canCommand = false;
	if(tags.badges){
		if(tags.badges.broadcaster){
			canCommand = true;
		}
	}
	if(tags.mod){
		canCommand = true;
	}
	
	// Mod/Streamer only commands
	if(canCommand){
		if(message === (config.trigger + "stop")){
			if(running) client.say(channel, 'TwitchCommander has been stopped.');
			running = false;
			console.log(`> ${tags.username} ran the stop command.`);
		}
		if(message === (config.trigger + "start")){
			if(!running) client.say(channel, 'TwitchCommander has been started.');
			running = true;
			console.log(`> ${tags.username} ran the start command.`);
		}
		if(message === (config.trigger + "bits")){
			config.bitRewards = !config.bitRewards;
			if(!config.bitRewards) client.say(channel, 'Bit Rewards have been turned off.');
			if(config.bitRewards) client.say(channel, 'Bit Rewards have been turned on.');
			writeConfig();
			console.log(`> ${tags.username} ran the bits command. bitRewards are currently ${config.bitRewards}`);
		}
		if(message.toString().startsWith(config.trigger + "updategame")){
			let newGame = message.toString().replace(config.trigger + "updategame ","");
			console.log(`> ${tags.username} ran the updategame command.`);
			if(Object.keys(voteChoices).includes(newGame)){
				client.say(channel, `Game changed to ${newGame}`);
				config.game = newGame;
				writeConfig();
				console.log(`>>> Game changed to ${config.game}.`);
				updateCommandListFile(voteActions[config.game]);
			}else{
				client.say(channel, 'Game Settings do not exist');
				console.log(`>>> Game wasn't changed as new game does not exist.`);
			}
		}
	}
	
	if(message === (config.trigger + "botstatus")){
		if(running) client.say(channel, 'TwitchCommander is running.');
		if(!running) client.say(channel, 'TwitchCommander is not running.');
		if(config.bitRewards) client.say(channel, 'Bit Rewards are being accepted.');
		if(!config.bitRewards) client.say(channel, 'Bit Rewards are not being accepted.');
		const windowStatus = await getWindowStatus();
		if (windowStatus.active) {
			client.say(channel, `Target window is active: ${windowStatus.processName}`);
		} else if (windowStatus.ready) {
			client.say(channel, `Target window is available but not focused. ${windowStatus.reason}`);
		} else {
			client.say(channel, `Target window is not ready: ${windowStatus.reason}`);
		}
		console.log(`> ${tags.username} ran the botstatus command.`);
		return;
	}

	if (message === (config.trigger + "cancel")) {
		const cancelledRun = await cancelActiveAutomation(`chat cancel by ${tags.username}`);
		clearPendingVoteTimeout();
		resetVoteState();
		client.say(channel, cancelledRun
			? "TwitchCommander cancelled the current automation and cleared pending votes."
			: "TwitchCommander cleared pending votes. No automation was currently running.");
		console.log(`> ${tags.username} ran the cancel command.`);
		return;
	}
	
	// Checks if the bot should be running
	if(!running) return;
	
	// Check for Help Command
	if(message === (config.trigger + "help") || message.startsWith(config.trigger + "help ")){
		const helpTarget = message.slice((config.trigger + "help").length).trim().toLowerCase();
		console.log(`> ${tags.username} ran the help command${helpTarget ? ` for ${helpTarget}` : ""}.`);
		if (helpTarget) {
			const matchedCommand = findCommandByChatName(config.game, helpTarget);
			if (!matchedCommand) {
				client.say(channel, `No command named ${helpTarget} exists for ${config.game}.`);
				return;
			}

			client.say(channel, `${config.trigger}${getCommandChatName(matchedCommand.commandKey, matchedCommand.details)} - ${matchedCommand.details.description}`);
			client.say(channel, `Usage: ${buildCommandUsage(matchedCommand.commandKey, matchedCommand.details)}`);
			if (normalizeBitCost(matchedCommand.details.bitCost) > 0) {
				client.say(channel, `Bit Reward: cheer${normalizeBitCost(matchedCommand.details.bitCost)}${buildBitArgumentSuffix(matchedCommand.details)}`);
			}
			client.say(channel, `${hasArgumentPlaceholders(matchedCommand.details) ? "Runs immediately with chat-supplied arguments." : "Vote command unless separately used as a bit reward."}`);
			return;
		}

		client.say(channel, 'Commands:');
		// Itterate through the choices array to see if any of them match.
		for (const action in voteActions[config.game]) {
			let actions = voteActions[config.game][action];
			client.say(channel, '  ' + config.trigger + actions.name + ' - ' + actions.description);
		}
		client.say(channel, '  ' + config.trigger + 'help <command> - Show description and usage for one command');
		client.say(channel, '  ' + config.trigger + 'cancel - Cancel the current automation and clear pending votes');
		if(config.bitRewards){
			const bitCommands = getBitCommandsForGame(config.game);
			if (bitCommands.length) {
				client.say(channel, 'Bit Rewards:');
				for (const { details } of bitCommands) {
					client.say(channel, `  cheer${details.bitCost}${buildBitArgumentSuffix(details)} - ${details.description}`);
				}
			}
		}
		return;
	}
	
	// Ignore echoed bot messages unless they are an actual broadcaster/mod command from the same account.
	if (tags.username === config.username && !canCommand) return;

	const parsedCommand = parseTriggeredCommandMessage(message);
	if (parsedCommand) {
		const matchedCommand = findCommandByChatName(config.game, parsedCommand.commandName);
		if (matchedCommand) {
			const requiredArgs = getRequiredArgumentCount(matchedCommand.details);
			if (hasArgumentPlaceholders(matchedCommand.details)) {
				if (parsedCommand.args.length < requiredArgs) {
					console.log(`> ${tags.username} attempted ${parsedCommand.commandName} without enough arguments.`);
					client.say(channel, `Usage: ${buildCommandUsage(matchedCommand.commandKey, matchedCommand.details)}`);
					return;
				}

				console.log(`> ${tags.username} ran ${parsedCommand.commandName} ${parsedCommand.args.join(" ")}.`);
				const completed = await runAutomation(
					matchedCommand.details.actions,
					`chat command ${parsedCommand.commandName}`,
					parsedCommand.args
				);
				if (completed) {
					recordRecentCommand(
						tags["display-name"] || tags.username,
						buildExecutedCommandText(matchedCommand.commandKey, matchedCommand.details, parsedCommand.args),
						"immediate"
					);
					client.say(channel, `Completed command: ${parsedCommand.commandName}`);
				}
				return;
			}
		}
	}
	
	// We shall check the message to see if it contains a choice
	// Then we will tally that choice and reset the timeout
	let vote = null;

	// Itterate through the choices array to see if any of them match.
	for (const choice of voteChoices[config.game]) {
		const commandDetails = voteActions[config.game][choice];
		if (hasArgumentPlaceholders(commandDetails)) {
			continue;
		}

		const chatName = getCommandChatName(choice, commandDetails);
		if (message === (config.trigger + chatName)) {
			console.log(`> ${tags.username} voted for ${chatName}.`);
			vote = choice;
			client.say(channel, `Vote of ${chatName} has been accepted. Tally will happen in ${config.tL} seconds!`);
			break;
		}
	}

	// if it matches at least one then add it to that vote's dictionary file
	if (vote != null) {
		if (!voteFirstActors[config.game][vote]) {
			voteFirstActors[config.game][vote] = tags["display-name"] || tags.username;
		}
		voteDict[config.game][vote]++;
		// Check if there was already a timeout set for announcing a winner
		// Reset that timer if true
		if(timeoutId !== null){ clearTimeout(timeoutId); }
		timeoutId = setTimeout(takeAction, config.tL * 1000);
	}
});

client.on("cheer", async (channel, user, message) => {
	console.log(`> ${user.display-name} has cheered ${user.bits}.`);
	// Checks if the bot should be running
	if(!running) return;
	
	// Check if bit rewards are being accepted
	if(!config.bitRewards) return;
	
	const args = splitBitRewardArguments(removeCheermotes(message, channel));
	const bitCommand = findBitCommandByCost(config.game, Number(user.bits));
	if (!bitCommand) {
		return;
	}

	const requiredArgs = getRequiredArgumentCount(bitCommand.details);
	if (args.length < requiredArgs) {
		client.say(channel, `Bit reward usage: cheer${bitCommand.details.bitCost}${buildBitArgumentSuffix(bitCommand.details)}`);
		console.log(`>>> ${user.display-name} cheered ${user.bits} without enough bit reward arguments.`);
		return;
	}

	console.log(`>>> ${user.display-name} triggered bit reward ${bitCommand.commandKey} with ${user.bits} bits.`);
	const completed = await runAutomation(
		bitCommand.details.actions,
		`${user.display-name} triggered bit reward ${bitCommand.commandKey}`,
		args
	);
	if (completed) {
		recordRecentCommand(
			user["display-name"] || user.username || user.login || "unknown",
			buildExecutedCommandText(bitCommand.commandKey, bitCommand.details, args),
			"bit"
		);
		client.say(channel, `Completed bit reward: ${getCommandChatName(bitCommand.commandKey, bitCommand.details)}`);
	}
});

// Actions to take once the vote has been counted
async function takeAction(){
	clearPendingVoteTimeout();
	// Get the winning vote and check if there was a winning vote at all
	client.say(config.channel,"Tallying the votes now!");
	console.log(`> Tallying the votes!`);
	const voteWinner = Object.keys(voteDict[config.game]).reduce((a, b) => voteDict[config.game][a] > voteDict[config.game][b] ? a : b);
	client.say(config.channel,`Winning Command: ${voteWinner}`);
	console.log(`>>> Winning Command: ${voteWinner}`);
	const allZero = Object.values(voteDict[config.game]).every(x => x === 0);
	
	// Check if there vote was a draw or non-existant then do the action most voted for
	if (allZero) {
		console.log("doing nothing");
	} else {
		let actions = voteActions[config.game][voteWinner].actions;
		const completed = await runAutomation(actions, `vote command ${voteWinner}`);
		if (completed) {
			recordRecentCommand(
				voteFirstActors[config.game][voteWinner] || "unknown",
				buildExecutedCommandText(voteWinner, voteActions[config.game][voteWinner]),
				"vote"
			);
			client.say(config.channel, `Completed command: ${getCommandChatName(voteWinner, voteActions[config.game][voteWinner])}`);
		}
	}
	
	// Reset the vote Dictionary so that it doesn't start off biased towards the last winner
	resetVoteState();
}

async function removeCheermotes(message, channelId) {
  const cheermotesJson = ['Cheer', 'DoodleCheer', 'BibleThump', 'cheerwhal', 'Corgo', 'Scoops', 'uni', 'ShowLove', 'Party', 'SeemsGood', 'Pride', 'Kappa', 'FrankerZ', 'HeyGuys', 'DansGame', 'EleGiggle', 'TriHard', 'Kreygasm', '4Head', 'SwiftRage', 'NotLikeThis', 'FailFish', 'VoHiYo', 'PJSalt', 'MrDestructoid', 'bday', 'RIPCheer', 'Shamrock', 'BitBoss', 'Streamlabs', 'Muxy', 'HolidayCheer', 'Goal', 'Anon', 'Charity'];
  const prefixes = cheermotesJson.join('|');
  const regex = new RegExp(`(?:^|\\b)(${prefixes})(\\d{1,6})(?:$|\\b)`, 'gi');
  return message.replace(regex, '');
}

function splitBitRewardArguments(message) {
	return String(message || "").trim().split(/\s+/).filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCommandsForGame(gameKey) {
	return commands[gameKey] || {};
}

function getCommandChatName(commandKey, commandDetails) {
	return String(commandDetails?.name || commandKey || "").trim().toLowerCase();
}

function parseTriggeredCommandMessage(message) {
	const trigger = String(config.trigger || "!").toLowerCase();
	if (!message.startsWith(trigger)) {
		return null;
	}

	const body = message.slice(trigger.length).trim();
	if (!body) {
		return null;
	}

	const parts = body.split(/\s+/).filter(Boolean);
	return {
		commandName: (parts[0] || "").toLowerCase(),
		args: parts.slice(1)
	};
}

function buildCommandUsage(commandKey, commandDetails) {
	return buildUsageString(config.trigger, getCommandChatName(commandKey, commandDetails), commandDetails);
}

function buildBitArgumentSuffix(commandDetails) {
	return buildArgumentSuffix(commandDetails);
}

function findCommandByChatName(gameKey, commandName) {
	for (const [commandKey, commandDetails] of Object.entries(getCommandsForGame(gameKey))) {
		if (getCommandChatName(commandKey, commandDetails) === commandName) {
			return { commandKey, details: commandDetails };
		}
	}

	return null;
}

function normalizeBitCost(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 0;
	}

	return Math.floor(parsed);
}

function getBitCommandsForGame(gameKey) {
	return Object.entries(getCommandsForGame(gameKey))
		.map(([commandKey, details]) => ({ commandKey, details }))
		.filter(({ details }) => normalizeBitCost(details?.bitCost) > 0)
		.sort((a, b) => normalizeBitCost(a.details.bitCost) - normalizeBitCost(b.details.bitCost));
}

function findBitCommandByCost(gameKey, bitCost) {
	return getBitCommandsForGame(gameKey).find(({ details }) => normalizeBitCost(details.bitCost) === normalizeBitCost(bitCost)) || null;
}

function resolveTemplateValue(template, args) {
	return String(template || "").replace(/\$([1-9]\d*)(\?([^|]+))?/g, (_, indexText, _fallbackGroup, fallbackValue) => {
		const value = args[Number(indexText) - 1];
		if (value === undefined || value === "") {
			return fallbackValue === undefined ? "" : String(fallbackValue);
		}
		return String(value);
	});
}

function resolveCoordinateToken(template, args, axisSize) {
	const templateText = String(template || "").trim();
	const resolvedText = resolveTemplateValue(templateText, args).trim();
	const placeholderPattern = /^\$([1-9]\d*)(\?([^|]+))?$/;
	const cameFromPlaceholder = placeholderPattern.test(templateText);
	const clampPercent = (value) => Math.min(100, Math.max(0, value));

	if (/^-?\d+(\.\d+)?px$/i.test(resolvedText)) {
		return String(Math.round(parseFloat(resolvedText)));
	}

	if (/^-?\d+(\.\d+)?%$/i.test(resolvedText)) {
		const percentValue = clampPercent(parseFloat(resolvedText));
		const maxIndex = Math.max(0, Number(axisSize || 0) - 1);
		return String(Math.round((percentValue / 100) * maxIndex));
	}

	if (cameFromPlaceholder && /^-?\d+(\.\d+)?$/.test(resolvedText)) {
		const percentValue = clampPercent(Number(resolvedText));
		const maxIndex = Math.max(0, Number(axisSize || 0) - 1);
		return String(Math.round((percentValue / 100) * maxIndex));
	}

	return resolvedText;
}

function resolveCommandActions(actions, args, targetBounds = null) {
	return (actions || []).map((action) => {
		const parts = String(action || "").split("|");
		switch (parts[0]) {
			case "mouse":
				parts[1] = resolveCoordinateToken(parts[1], args, targetBounds?.width);
				parts[2] = resolveCoordinateToken(parts[2], args, targetBounds?.height);
				parts[3] = resolveTemplateValue(parts[3], args);
				parts[4] = resolveTemplateValue(parts[4], args);
				parts[5] = resolveTemplateValue(parts[5], args);
				parts[6] = resolveTemplateValue(parts[6], args);
				return parts.join("|");
			case "mousehold":
				parts[1] = resolveCoordinateToken(parts[1], args, targetBounds?.width);
				parts[2] = resolveCoordinateToken(parts[2], args, targetBounds?.height);
				parts[3] = resolveTemplateValue(parts[3], args);
				parts[4] = resolveTemplateValue(parts[4], args);
				parts[5] = resolveTemplateValue(parts[5], args);
				parts[6] = resolveTemplateValue(parts[6], args);
				parts[7] = resolveTemplateValue(parts[7], args);
				return parts.join("|");
			case "mousedrag":
				parts[1] = resolveCoordinateToken(parts[1], args, targetBounds?.width);
				parts[2] = resolveCoordinateToken(parts[2], args, targetBounds?.height);
				parts[3] = resolveCoordinateToken(parts[3], args, targetBounds?.width);
				parts[4] = resolveCoordinateToken(parts[4], args, targetBounds?.height);
				parts[5] = resolveTemplateValue(parts[5], args);
				parts[6] = resolveTemplateValue(parts[6], args);
				parts[7] = resolveTemplateValue(parts[7], args);
				parts[8] = resolveTemplateValue(parts[8], args);
				return parts.join("|");
			default:
				return resolveTemplateValue(action, args);
		}
	});
}

mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 40;

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

function toNutKey(key) {
	const value = String(key || "").trim();
	const normalized = value.toLowerCase();
	const namedKeys = {
		enter: Key.Return,
		return: Key.Return,
		escape: Key.Escape,
		esc: Key.Escape,
		tab: Key.Tab,
		backspace: Key.Backspace,
		delete: Key.Delete,
		up: Key.Up,
		down: Key.Down,
		left: Key.Left,
		right: Key.Right,
		home: Key.Home,
		end: Key.End,
		pageup: Key.PageUp,
		pagedown: Key.PageDown,
		insert: Key.Insert,
	space: Key.Space,
	shift: Key.LeftShift,
	control: Key.LeftControl,
	ctrl: Key.LeftControl,
	alt: Key.LeftAlt,
		"+": Key.Add,
		"-": Key.Minus
	};

	if (namedKeys[normalized] !== undefined) {
		return namedKeys[normalized];
	}

	if (/^[a-z]$/i.test(value)) {
		return Key[value.toUpperCase()];
	}

	if (/^[0-9]$/.test(value)) {
		return Key[`Num${value}`];
	}

	return null;
}

const automation = {
	async moveMouse(x, y) {
		await mouse.setPosition({
			x: Number(x),
			y: Number(y)
		});
	},

	async mouseClick(button = "left") {
		const mappedButton = toNutButton(button);
		if (mappedButton === null) {
			return;
		}

		await mouse.click(mappedButton);
	},

	async modifiedMouseClick(button = "left", modifiers = []) {
		const mappedButton = toNutButton(button);
		if (mappedButton === null) {
			return;
		}

		const mappedModifiers = modifiers.map((modifier) => toNutKey(modifier)).filter((value) => value !== null);
		for (const modifier of mappedModifiers) {
			heldKeys.add(modifier);
		}
		await keyboard.pressKey(...mappedModifiers);
		try {
			await mouse.click(mappedButton);
		} finally {
			for (const modifier of mappedModifiers) {
				heldKeys.delete(modifier);
			}
			if (mappedModifiers.length) {
				await keyboard.releaseKey(...mappedModifiers.slice().reverse());
			}
		}
	},

	async mouseHold(button = "left", durationMs = 0) {
		const mappedButton = toNutButton(button);
		const numericDuration = Number(durationMs);
		if (mappedButton === null) {
			throw new Error(`Mouse hold does not support button "${button}".`);
		}
		if (!Number.isFinite(numericDuration) || numericDuration < 0) {
			throw new Error("Mouse hold duration must be a non-negative number of milliseconds.");
		}

		await mouse.pressButton(mappedButton);
		heldMouseButtons.add(mappedButton);
		try {
			await cancellableSleep(numericDuration, activeAutomationSession);
		} finally {
			heldMouseButtons.delete(mappedButton);
			await mouse.releaseButton(mappedButton);
		}
	},

	async modifiedMouseHold(button = "left", durationMs = 0, modifiers = []) {
		const mappedButton = toNutButton(button);
		const numericDuration = Number(durationMs);
		if (mappedButton === null) {
			throw new Error(`Mouse hold does not support button "${button}".`);
		}
		if (!Number.isFinite(numericDuration) || numericDuration < 0) {
			throw new Error("Mouse hold duration must be a non-negative number of milliseconds.");
		}

		const mappedModifiers = modifiers.map((modifier) => toNutKey(modifier)).filter((value) => value !== null);
		for (const modifier of mappedModifiers) {
			heldKeys.add(modifier);
		}
		await keyboard.pressKey(...mappedModifiers);
		await mouse.pressButton(mappedButton);
		heldMouseButtons.add(mappedButton);
		try {
			await cancellableSleep(numericDuration, activeAutomationSession);
		} finally {
			heldMouseButtons.delete(mappedButton);
			await mouse.releaseButton(mappedButton);
			for (const modifier of mappedModifiers) {
				heldKeys.delete(modifier);
			}
			if (mappedModifiers.length) {
				await keyboard.releaseKey(...mappedModifiers.slice().reverse());
			}
		}
	},

	async mouseDrag(startX, startY, endX, endY, button = "left", modifiers = []) {
		const mappedButton = toNutButton(button);
		if (mappedButton === null) {
			throw new Error(`Mouse drag does not support button "${button}".`);
		}

		const mappedModifiers = modifiers.map((modifier) => toNutKey(modifier)).filter((value) => value !== null);
		for (const modifier of mappedModifiers) {
			heldKeys.add(modifier);
		}
		if (mappedModifiers.length) {
			await keyboard.pressKey(...mappedModifiers);
		}
		await mouse.setPosition({
			x: Number(startX),
			y: Number(startY)
		});
		await mouse.pressButton(mappedButton);
		heldMouseButtons.add(mappedButton);
		try {
			ensureNotCancelled(activeAutomationSession);
			await mouse.setPosition({
				x: Number(endX),
				y: Number(endY)
			});
			ensureNotCancelled(activeAutomationSession);
		} finally {
			heldMouseButtons.delete(mappedButton);
			await mouse.releaseButton(mappedButton);
			for (const modifier of mappedModifiers) {
				heldKeys.delete(modifier);
			}
			if (mappedModifiers.length) {
				await keyboard.releaseKey(...mappedModifiers.slice().reverse());
			}
		}
	},

	async scrollMouse(amount) {
		const numericAmount = Number(amount);
		if (!Number.isFinite(numericAmount) || numericAmount === 0) {
			return;
		}

		if (numericAmount > 0) {
			await mouse.scrollUp(Math.abs(numericAmount));
			return;
		}

		await mouse.scrollDown(Math.abs(numericAmount));
	},

	async keyTap(key) {
		const mappedKey = toNutKey(key);
		if (mappedKey !== null) {
			await keyboard.type(mappedKey);
			return;
		}

		await keyboard.type(String(key));
	},

	async modifiedKeyTap(key, modifiers = []) {
		const mappedKey = toNutKey(key);
		if (mappedKey === null) {
			throw new Error(`Modified key tap does not support unmapped key "${key}".`);
		}

		const mappedModifiers = modifiers.map((modifier) => toNutKey(modifier)).filter((value) => value !== null);
		await keyboard.type(...mappedModifiers, mappedKey);
	},

	async keyHold(key, durationMs) {
		const mappedKey = toNutKey(key);
		const numericDuration = Number(durationMs);
		if (!Number.isFinite(numericDuration) || numericDuration < 0) {
			throw new Error("Key hold duration must be a non-negative number of milliseconds.");
		}
		if (mappedKey === null) {
			throw new Error(`Key hold does not support unmapped key "${key}".`);
		}

		await keyboard.pressKey(mappedKey);
		heldKeys.add(mappedKey);
		try {
			await cancellableSleep(numericDuration, activeAutomationSession);
		} finally {
			heldKeys.delete(mappedKey);
			await keyboard.releaseKey(mappedKey);
		}
	},

	async modifiedKeyHold(key, durationMs, modifiers = []) {
		const mappedKey = toNutKey(key);
		const numericDuration = Number(durationMs);
		if (!Number.isFinite(numericDuration) || numericDuration < 0) {
			throw new Error("Key hold duration must be a non-negative number of milliseconds.");
		}
		if (mappedKey === null) {
			throw new Error(`Modified key hold does not support unmapped key "${key}".`);
		}

		const mappedModifiers = modifiers.map((modifier) => toNutKey(modifier)).filter((value) => value !== null);
		const keysToHold = [...mappedModifiers, mappedKey];
		for (const heldKey of keysToHold) {
			heldKeys.add(heldKey);
		}
		await keyboard.pressKey(...keysToHold);
		try {
			await cancellableSleep(numericDuration, activeAutomationSession);
		} finally {
			for (const heldKey of keysToHold) {
				heldKeys.delete(heldKey);
			}
			await keyboard.releaseKey(...keysToHold.slice().reverse());
		}
	},

	async typeString(text) {
		await keyboard.type(String(text));
	}
};

function getActionModifiers(parts, startIndex = 3) {
	const modifiers = [];
	if (String(parts[startIndex] || "0") === "1") {
		modifiers.push("shift");
	}
	if (String(parts[startIndex + 1] || "0") === "1") {
		modifiers.push("control");
	}
	if (String(parts[startIndex + 2] || "0") === "1") {
		modifiers.push("alt");
	}
	return modifiers;
}

function resolveMousePosition(targetBounds, relativeX, relativeY) {
	const x = Number(relativeX);
	const y = Number(relativeY);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error("Mouse action requires numeric X and Y coordinates.");
	}

	if (!targetBounds || !Number.isFinite(targetBounds.width) || !Number.isFinite(targetBounds.height)) {
		throw new Error("Target window bounds are unavailable.");
	}

	if (x < 0 || y < 0 || x >= targetBounds.width || y >= targetBounds.height) {
		throw new Error(`Mouse coordinates ${x}, ${y} are outside the bounded input area ${targetBounds.width}x${targetBounds.height}.`);
	}

	return {
		x: targetBounds.x + x,
		y: targetBounds.y + y
	};
}

async function getWindowStatus() {
	const status = await getTargetWindowStatus(config);
	return {
		ready: Boolean(status.targetWindow),
		active: status.active,
		reason: status.reason,
		processName: status.targetWindow?.processName || status.targetWindow?.title || ""
	};
}

async function runAutomation(actions, contextLabel, actionArgs = []) {
	const session = createAutomationSession(contextLabel);
	const activation = await prepareTargetWindow(config);
	if (!activation.ready) {
		if (activeAutomationSession === session) {
			activeAutomationSession = null;
		}
		const warning = `Automation skipped for ${contextLabel}. ${activation.reason}`;
		if (warning !== lastWindowWarning) {
			console.log(warning);
			lastWindowWarning = warning;
		}
		return false;
	}

	lastWindowWarning = "";
	try {
		const targetBounds = activation.bounds;
		const resolvedActions = resolveCommandActions(actions, actionArgs, targetBounds);
		for (const action of resolvedActions) {
			ensureNotCancelled(session);
			if (typeof action === "function") {
				await action();
				continue;
			}

			let act = action.split("|");
			switch (act[0]){
			  case "mouse":
				{
					const resolvedPosition = resolveMousePosition(targetBounds, act[1], act[2]);
					await automation.moveMouse(resolvedPosition.x, resolvedPosition.y);
					const modifiers = getActionModifiers(act, 4);
					if(act[3] != "none") {
						if (modifiers.length) {
							await automation.modifiedMouseClick(act[3], modifiers);
						} else {
							await automation.mouseClick(act[3]);
						}
					}
				}
				break;
			  case "mousehold":
				{
					const resolvedPosition = resolveMousePosition(targetBounds, act[1], act[2]);
					await automation.moveMouse(resolvedPosition.x, resolvedPosition.y);
					const modifiers = getActionModifiers(act, 5);
					if (modifiers.length) {
						await automation.modifiedMouseHold(act[3], act[4], modifiers);
					} else {
						await automation.mouseHold(act[3], act[4]);
					}
				}
				break;
			  case "mousedrag":
				{
					const startPosition = resolveMousePosition(targetBounds, act[1], act[2]);
					const endPosition = resolveMousePosition(targetBounds, act[3], act[4]);
					const modifiers = getActionModifiers(act, 6);
					await automation.mouseDrag(
						startPosition.x,
						startPosition.y,
						endPosition.x,
						endPosition.y,
						act[5],
						modifiers
					);
				}
				break;
			  case "scroll":
				await automation.scrollMouse(Number(act[1]));
				break;
			  case "keytap":
				for(let i = 0; i < Number(act[2]); i++){
					ensureNotCancelled(session);
					const modifiers = getActionModifiers(act, 3);
					if (modifiers.length) {
						await automation.modifiedKeyTap(act[1], modifiers);
					} else {
						await automation.keyTap(act[1]);
					}
				}
				break;
			  case "keyhold":
				{
					const modifiers = getActionModifiers(act, 3);
					if (modifiers.length) {
						await automation.modifiedKeyHold(act[1], act[2], modifiers);
					} else {
						await automation.keyHold(act[1], act[2]);
					}
				}
				break;
			}
			await cancellableSleep(2000, session);
		}
	} catch (error) {
		if (error instanceof AutomationCancelledError) {
			console.log(error.message);
			return false;
		}

		const errorMessage = error && error.message ? error.message : String(error);
		console.error(`Automation failed for ${contextLabel}: ${errorMessage}`);
		return false;
	} finally {
		await releaseHeldInputs();
		if (activation.switched) {
			await restorePreviousWindow(activation.previousWindow, activation.targetWindow);
		}
		if (activeAutomationSession === session) {
			activeAutomationSession = null;
		}
	}

	return true;
}

function updateCommandListFile(commands){
	console.log(`Updating Command List.`);
	let commandList = 'Commands:\n';
	for (const action in commands) {
		let actions = commands[action];
		commandList += `  ${config.trigger}${actions.name} - ${actions.description}\n`;
	}

	const bitCommands = Object.values(commands || {})
		.filter((details) => normalizeBitCost(details?.bitCost) > 0)
		.sort((a, b) => normalizeBitCost(a.bitCost) - normalizeBitCost(b.bitCost));
	if (bitCommands.length) {
		commandList += '\nBit Rewards:\n';
		for (const details of bitCommands) {
			commandList += `  cheer${details.bitCost}${buildBitArgumentSuffix(details)} - ${details.description}\n`;
		}
	}

	fs.writeFileSync(commandListPath, commandList, "utf8");
}
