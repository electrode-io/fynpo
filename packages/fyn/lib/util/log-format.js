"use strict";

/* eslint-disable no-magic-numbers */

const chalk = require("chalk");
const { posixify } = require("./fyntil");

module.exports = {
  pkgPath: (name, yp) => {
    const nm = "node_modules";
    const posixPath = posixify(yp);
    const ixName = posixPath.indexOf(name);
    if (ixName > 0) {
      const ixNm = posixPath.lastIndexOf(nm, ixName);
      return (
        chalk.blue(`${posixPath.substr(ixNm, ixName - ixNm)}`) +
        chalk.magenta(name) +
        posixPath.substr(ixName + name.length)
      );
    } else {
      return chalk.blue(posixPath);
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
