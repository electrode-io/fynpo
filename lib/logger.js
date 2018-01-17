"use strict";

const VisualLogger = require("visual-logger");

const logger = new VisualLogger();

if (process.env.CI) {
  logger.info("CI env detected");
  logger.setItemType("none");
}

module.exports = logger;
