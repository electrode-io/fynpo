"use strict";

const Fs = require("fs");
const Path = require("path");
const Yaml = require("yamljs");
const _ = require("lodash");
const logger = require("../lib/logger");

function readRc(fname) {
  try {
    const rc = Yaml.parse(Fs.readFileSync(fname).toString());
    logger.debug("Loaded RC", fname, JSON.stringify(rc));
    return rc;
  } catch (e) {
    if (e.code !== "ENOENT") {
      logger.error("Failed to process RC file", fname, e.message);
    }
    return undefined;
  }
}

function loadRc(cwd) {
  let rcName, rcData;

  const defaults = {
    registry: "https://registry.npmjs.org",
    targetDir: "node_modules"
  };

  const rc = [Path.join(process.env.HOME, ".fynrc"), Path.join(cwd, ".fynrc")].map(readRc);

  const merged = _.merge.apply(_, [defaults].concat(rc));

  return merged;
}

module.exports = loadRc;
