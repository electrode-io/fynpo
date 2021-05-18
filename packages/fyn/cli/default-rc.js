"use strict";

const ci = require("ci-info");

module.exports = {
  registry: "https://registry.npmjs.org",
  targetDir: "node_modules",
  progress: ci.isCI ? "none" : "normal"
};
