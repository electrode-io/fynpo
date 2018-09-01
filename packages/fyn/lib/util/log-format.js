"use strict";

/* eslint-disable no-magic-numbers */

const chalk = require("chalk");

module.exports = {
  pkgPath: (name, path) => {
    const x = path.indexOf(name);
    if (x > 0) {
      return chalk.blue("node_modules/") + chalk.magenta(name) + path.substr(x + name.length);
    } else {
      return chalk.blue(path);
    }
  },

  pkgId: (name, version) => {
    if (typeof name !== "string") {
      if (name.version) {
        version = name.version;
      } else if (name.resolved) {
        version = name.resolved;
      } else if (name.semver) {
        version = name.semver;
      }

      name = name.name;
    }

    if (version !== undefined) {
      const dimAt = chalk.cyan.dim("@");
      return chalk.magenta(`${name}${dimAt}${version}`);
    }

    return chalk.magenta(name);
  },

  time: x => {
    x /= 1000;
    const m = chalk.magenta(`${x}`);
    return `${m}secs`;
  },

  timeWarn: x => {
    x /= 1000;
    const m = chalk.yellow(`${x}`);
    return `${m}secs`;
  }
};
