"use strict";

const chalk = require("chalk");
const logger = require("../lib/logger");
const findFlatModule = require("./find-flat-module");

module.exports = function() {
  if (process.platform === "win32") {
    const fmModule = findFlatModule();
    logger.fyi(
      "To setup flat-module for Windows, run the command:",
      chalk.magenta(`fyn win && fynwin`)
    );
  } else {
    const setupSh = "eval `fyn bash`";
    logger.fyi(`To setup for bash, run the command "${chalk.cyan(setupSh)}"`);
  }
};
