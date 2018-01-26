"use strict";

if (process.platform === "win32") {
  module.exports = require("./pkg-bin-linker-win32");
} else {
  module.exports = require("./pkg-bin-linker-unix");
}
