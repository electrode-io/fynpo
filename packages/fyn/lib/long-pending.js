"use strict";

/* eslint-disable no-magic-numbers, max-statements, no-param-reassign */

const MAX_PENDING_SHOW = 10;
const chalk = require("chalk");
const logFormat = require("./util/log-format");
const logger = require("./logger");
const _ = require("lodash");
const { LONG_WAIT_PACKAGE } = require("./log-items");

module.exports = {
  onWatch: (items, options) => {
    options = options || {};
    const logItemName = options.name || LONG_WAIT_PACKAGE;

    if (items.total === 0) {
      logger.removeItem(logItemName);
      return;
    }

    let all = items.watched.concat(items.still);

    if (options.filter) all = all.filter(options.filter);

    if (all.length === 0) {
      logger.removeItem(logItemName);
      return;
    }

    if (!logger.hasItem(logItemName)) {
      logger.addItem({
        name: logItemName,
        display: options.display,
        color: "yellow"
      });
    }
    let msg = "";
    if (all.length > MAX_PENDING_SHOW) {
      msg = chalk.cyan(`Total: ${all.length}, first ${MAX_PENDING_SHOW}: `);
    }

    const pendings = _(all.slice(0, MAX_PENDING_SHOW)) // show max 10 pendings
      .map(x => {
        return { id: typeof x.item === "string" ? x.item : options.makeId(x.item), time: x.time };
      })
      .sortBy("id")
      .value();
    const str = pendings.map(x => `${chalk.magenta(x.id)} (${logFormat.timeWarn(x.time)})`);
    msg += str.join(chalk.blue(", "));

    logger.updateItem(logItemName, {
      msg,
      _save: options._save !== undefined ? options._save : false
    });
  }
};
