"use strict";

/* eslint-disable no-magic-numbers */

const chalk = require("chalk");

module.exports = {
  pkgPath: (name, yp) => {
    const nm = "node_modules";
    const ixName = yp.indexOf(name);
    if (ixName > 0) {
      const ixNm = yp.lastIndexOf(nm, ixName);
      return (
        chalk.blue(`${yp.substr(ixNm, ixName - ixNm)}`) +
        chalk.magenta(name) +
        yp.substr(ixName + name.length)
      );
    } else {
      return chalk.blue(yp);
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
    const m = chalk.magenta(`${x.toFixed(3)}`);
    return `${m}secs`;
  },

  timeWarn: x => {
    x /= 1000;
    const m = chalk.yellow(`${x.toFixed(3)}`);
    return `${m}secs`;
  }
};
