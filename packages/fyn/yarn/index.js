"use strict";

const parse = require("./lib/lockfile/parse").default;

module.exports = {
  parseYarnLock: (str, filename) => parse(str, filename).object
};
