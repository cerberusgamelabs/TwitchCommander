const fs = require("fs");
const path = require("path");
const readline = require("readline");

const configPath = path.join(__dirname, "data", "config.json");
const commandsPath = path.join(__dirname, "data", "commands.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function askQuestion(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function normalizeChannel(value, fallbackUsername) {
  const input = String(value || fallbackUsername || "").trim().replace(/^#/, "");
  return input ? `#${input}` : "";
}

function parseBoolean(value, fallback) {
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (["y", "yes", "true", "1"].includes(normalized)) {
    return true;
  }
  if (["n", "no", "false", "0"].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function main() {
  const existingConfig = readJson(configPath);
  const commands = readJson(commandsPath);
  const availableGames = Object.keys(commands);
  const defaultGame = existingConfig.game || availableGames[0] || "bibites";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("==================================");
    console.log(" Twitch Commander Setup");
    console.log("==================================");
    console.log("");
    console.log("This setup writes data/config.json.");
    console.log("OAuth is handled inside the app with the Get Token button.");
    console.log("");

    const usernameInput = await askQuestion(
      rl,
      `Bot Username [${existingConfig.username || ""}]: `
    );
    const username = usernameInput || existingConfig.username || "";

    const channelInput = await askQuestion(
      rl,
      `Channel [${normalizeChannel(existingConfig.channel, username)}]: `
    );
    const channel = normalizeChannel(
      channelInput || existingConfig.channel,
      username
    );

    const triggerInput = await askQuestion(
      rl,
      `Command Trigger [${existingConfig.trigger || "!"}]: `
    );
    const trigger = triggerInput || existingConfig.trigger || "!";

    const voteLengthInput = await askQuestion(
      rl,
      `Vote Length in Seconds [${existingConfig.tL || 15}]: `
    );
    const parsedVoteLength = Number(voteLengthInput);
    const tL = Number.isFinite(parsedVoteLength) && parsedVoteLength > 0
      ? parsedVoteLength
      : (existingConfig.tL || 15);

    const bitRewardsInput = await askQuestion(
      rl,
      `Enable Bit Rewards (y/n) [${existingConfig.bitRewards ? "y" : "n"}]: `
    );
    const bitRewards = parseBoolean(bitRewardsInput, Boolean(existingConfig.bitRewards));

    console.log("");
    console.log(`Available Games: ${availableGames.join(", ")}`);
    const gameInput = await askQuestion(
      rl,
      `Active Game [${defaultGame}]: `
    );
    const game = availableGames.includes(gameInput) ? gameInput : defaultGame;

    const nextConfig = {
      ...existingConfig,
      username,
      channel,
      trigger,
      tL,
      bitRewards,
      game
    };

    writeJson(configPath, nextConfig);

    console.log("");
    console.log(`Saved ${configPath}`);
    console.log("");
    console.log("WARNING");
    console.log("-------");
    console.log("TwitchCommander checks whether the configured target process is running");
    console.log("before sending commands. If the target game is not running, commands");
    console.log("will be skipped.");
    console.log("");
    console.log("It does not currently verify that the game window is the frontmost");
    console.log("active window. If the target process is running but another app is");
    console.log("focused, automated inputs may go to the wrong place.");
    console.log("");
    console.log("Do not leave the bot running unattended unless you are comfortable");
    console.log("with that risk.");
    console.log("");
    console.log("Next steps:");
    console.log("1. Run npm start");
    console.log("2. Click Get Token inside the app");
    console.log("3. Start the bot after Twitch auth completes");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
