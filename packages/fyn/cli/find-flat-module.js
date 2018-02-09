"use strict";

const Path = require("path");

module.exports = () => {
  try {
    return eval("require").resolve("flat-module/flat-module.js");
  } catch (e) {
    return Path.join(__dirname, "../dist/flat-module.js");
  }
};
