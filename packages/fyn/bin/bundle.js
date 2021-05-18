"use strict";

var maj = parseInt(process.versions.node.split(".")[0], 10);

if (maj >= 8) {
  module.exports = "../dist/fyn.js";
} else {
  console.log("Sorry, node version below 8 is not supported.  Your version is", maj);
  process.exit(1);
}
