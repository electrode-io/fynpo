"use strict";

var maj = parseInt(process.versions.node.split(".")[0], 10);

if (maj >= 8) {
  try {
    require("../dist/v8-compile-cache");
  } catch (err) {
    //
  }
  module.exports = "../dist/fyn.js";
} else {
  console.log("Sorry, fyn does not support node version below 8.  Your version is", maj);
  process.exit(1);
}
