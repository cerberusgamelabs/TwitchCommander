// The Required node modules
const tmi = require('tmi.js');
const fs = require("fs");
const path = require("path");
const { mouse, keyboard, Button, Key } = require("@nut-tree/nut-js");
const {
	getTargetWindowStatus,
	prepareTargetWindow,
	restorePreviousWindow
} = require("../shared/window-control");
const dataDir = path.resolve(__dirname, "..", "..", "data");
const configPath = path.join(dataDir, "config.json");
const commandsPath = path.join(dataDir, "commands.json");
const commandListPath = path.join(dataDir, "CommandList.txt");
let config = readJson(configPath);
let commands = readJson(commandsPath);

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeConfig() {
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
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

// Setting variables
let timeoutId = null;
let running = true;
let lastWindowWarning = "";

function hasUsableOAuth() {
	return typeof config.oauth === "string" &&
		config.oauth.startsWith("oauth:") &&
		config.oauth.length > "oauth:".length;
}

function logOAuthHelp(reason) {
	console.error(`Twitch OAuth problem: ${reason}`);
	console.error("Open the GUI, click 'Get OAuth Token', sign in as the bot account, then paste the token in oauth:... format and save.");
}

updateCommandListFile(voteActions[config.game]);

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

// We shall pass the parameters which shall be required
client.on('message', async (channel, tags, message, self) => {
	// debug Code
	//console.log(voteDict);
	//console.log(voteDict[config.game]);
	
	// Convert message to lowercase
	message = message.toLowerCase();
	
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
	
	// Checks if the bot should be running
	if(!running) return;
	
	// Check for Help Command
	if(message === (config.trigger + "help")){
		console.log(`> ${tags.username} ran the help command.`);
		client.say(channel, 'Commands:');
		// Itterate through the choices array to see if any of them match.
		for (const action in voteActions[config.game]) {
			let actions = voteActions[config.game][action];
			client.say(channel, '  ' + config.trigger + actions.name + ' - ' + actions.description);
		}
		if(config.bitRewards){
			client.say(channel, 'Bit Rewards:');
			client.say(channel, '  cheer200 name - Name a random bibite');
			client.say(channel, '  cheer500      - Cause a random bibite to lay an egg');
			client.say(channel, '  cheer1000     - Kill a random bibite');
		}
	}
	
	// Checks if the bot sent the message
	if (tags.username === config.username) return;
	
	// We shall check the message to see if it contains a choice
	// Then we will tally that choice and reset the timeout
	let vote = null;

	// Itterate through the choices array to see if any of them match.
	for (const choice of voteChoices[config.game]) {
		if (message === (config.trigger + choice)) {
			console.log(`> ${tags.username} voted for ${choice}.`);
			vote = choice;
			client.say(channel, `Vote of ${choice} has been accepted. Tally will happen in ${config.tL} seconds!`);
			break;
		}
	}

	// if it matches at least one then add it to that vote's dictionary file
	if (vote != null) {
		voteDict[config.game][vote]++;
		// Check if there was already a timeout set for announcing a winner
		// Reset that timer if true
		if(timeoutId === null){ clearTimeout(timeoutId); }
		timeoutId = setTimeout(takeAction, config.tL * 1000);
	}
});

client.on("cheer", (channel, user, message) => {
	console.log(`> ${user.display-name} has cheered ${user.bits}.`);
	// Checks if the bot should be running
	if(!running) return;
	
	// Check if bit rewards are being accepted
	if(!config.bitRewards) return;
	
	let args = removeCheermotes(message, channel);
	
	// Check for bit rewards then do
	if(user.bits === 200){
		console.log(`>>> ${user.display-name} triggered the rename bit reward, renaming a random Bibite ${args}.`);
		runAutomation([
			() => automation.keyTap("r"),
			() => automation.moveMouse(40, 40),
			() => automation.mouseClick(),
			() => automation.moveMouse(435, 1080),
			() => automation.mouseClick(),
			() => automation.typeString(args),
			() => automation.keyTap("enter")
		], `${user.display-name} triggered the rename bit reward`);
	}
	if(user.bits === 500){
		console.log(`>>> ${user.display-name} triggered one random Bibite to lay an egg.`);
		runAutomation([
			() => automation.keyTap("r"),
			() => automation.moveMouse(40, 40),
			() => automation.mouseClick(),
			() => automation.moveMouse(510, 1270),
			() => automation.mouseClick()
		], `${user.display-name} triggered the egg bit reward`);
	}
	if(user.bits === 1000){
		console.log(`>>> ${user.display-name} has killed a random Bibite.`);
		runAutomation([
			() => automation.keyTap("r"),
			() => automation.moveMouse(40, 40),
			() => automation.mouseClick(),
			() => automation.moveMouse(510, 1250),
			() => automation.mouseClick()
		], `${user.display-name} triggered the kill bit reward`);
		client.say(channel, `${user["display-name"]}... you monster... think of their family!`);
	}
});

// Actions to take once the vote has been counted
async function takeAction(){
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
		await runAutomation(actions, `vote command ${voteWinner}`);
	}
	
	// Reset the vote Dictionary so that it doesn't start off biased towards the last winner
	for (const dict in voteDict[config.game]) {
		voteDict[config.game][dict] = 0;
	}
}

async function removeCheermotes(message, channelId) {
  const cheermotesJson = ['Cheer', 'DoodleCheer', 'BibleThump', 'cheerwhal', 'Corgo', 'Scoops', 'uni', 'ShowLove', 'Party', 'SeemsGood', 'Pride', 'Kappa', 'FrankerZ', 'HeyGuys', 'DansGame', 'EleGiggle', 'TriHard', 'Kreygasm', '4Head', 'SwiftRage', 'NotLikeThis', 'FailFish', 'VoHiYo', 'PJSalt', 'MrDestructoid', 'bday', 'RIPCheer', 'Shamrock', 'BitBoss', 'Streamlabs', 'Muxy', 'HolidayCheer', 'Goal', 'Anon', 'Charity'];
  const prefixes = cheermotesJson.join('|');
  const regex = new RegExp(`(?:^|\\b)(${prefixes})(\\d{1,6})(?:$|\\b)`, 'gi');
  return message.replace(regex, '');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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

	async typeString(text) {
		await keyboard.type(String(text));
	}
};

async function getWindowStatus() {
	const status = await getTargetWindowStatus(config);
	return {
		ready: Boolean(status.targetWindow),
		active: status.active,
		reason: status.reason,
		processName: status.targetWindow?.processName || status.targetWindow?.title || ""
	};
}

async function runAutomation(actions, contextLabel) {
	const activation = await prepareTargetWindow(config);
	if (!activation.ready) {
		const warning = `Automation skipped for ${contextLabel}. ${activation.reason}`;
		if (warning !== lastWindowWarning) {
			console.log(warning);
			lastWindowWarning = warning;
		}
		return false;
	}

	lastWindowWarning = "";
	try {
		for (const action of actions) {
			if (typeof action === "function") {
				await action();
				continue;
			}

			let act = action.split("|");
			switch (act[0]){
			  case "mouse":
				await automation.moveMouse(Number(act[1]), Number(act[2]));
				if(act[3] != "none") await automation.mouseClick(act[3]);
				break;
			  case "scroll":
				await automation.scrollMouse(Number(act[1]));
				break;
			  case "keytap":
				for(let i = 0; i < Number(act[2]); i++){
					await automation.keyTap(act[1]);
				}
				break;
			}
			await sleep(2000);
		}
	} finally {
		if (activation.switched) {
			await restorePreviousWindow(activation.previousWindow, activation.targetWindow);
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

	fs.writeFileSync(commandListPath, commandList, "utf8");
}
