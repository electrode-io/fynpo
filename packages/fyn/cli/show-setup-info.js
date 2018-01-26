"use strict";

const chalk = require("chalk");
const logger = require("../lib/logger");
const findFlatModule = require("./find-flat-module");

module.exports = function() {
  if (process.platform === "win32") {
    const fmModule = findFlatModule();
    logger.fyi("To setup for windows, run the command below:");
    logger.prefix(false).fyi(chalk.magenta(`set NODE_OPTIONS=-r ${fmModule}`));
    logger.fyi(`You can the command "fyn win" to generate a file "fynwin.cmd" at your CWD.`);
  } else {
    const setupSh = "eval `fyn bash`";
    logger.fyi(`To setup for bash, run the command "${chalk.cyan(setupSh)}"`);
  }
};
