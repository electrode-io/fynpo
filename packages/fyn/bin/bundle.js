"use strict";

var maj = parseInt(process.versions.node.split(".")[0], 10);

if (maj >= 8) {
  try {
    require("../dist/v8-compile-cache");
  } catch (err) {
    if (
      // is error caused by module not found?
      (err.code &&
        err.code !== "MODULE_NOT_FOUND" &&
        err.message.indexOf("Cannot find module") < 0) ||
      // is the not found module the one we are trying to require?
      err.message.indexOf("v8-compile-cache") < 0
    ) {
      console.log(`Failed loading v8-compile-cache`, err);
    }
  }
  module.exports = "../dist/fyn.js";
} else {
  console.log("Sorry, fyn does not support node version below 8.  Your version is", maj);
  process.exit(1);
}
