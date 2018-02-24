"use strict";

/* eslint-disable global-require */

/* istanbul ignore next */
if (process.platform === "win32") {
  /* istanbul ignore next */
  module.exports = require("./pkg-bin-linker-win32");
} else {
  module.exports = require("./pkg-bin-linker-unix");
}
