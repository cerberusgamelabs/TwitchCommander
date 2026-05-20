module.exports = {
  apps : [{
    name   : "TwitchCommander",
    script : "app/bot/main.js",
	watch  : true,
	ignore_watch: ["logs", "node_modules", "data"],
	time   : true,
    error_file : "V:/Programs/TwitchCommander/logs/err.log",
    out_file : "V:/Programs/TwitchCommander/logs/out.log"
  }]
}
