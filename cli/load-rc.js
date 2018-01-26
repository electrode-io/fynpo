"use strict";

const Fs = require("fs");
const Path = require("path");
const Yaml = require("yamljs");
const Ini = require("ini");
const _ = require("lodash");
const logger = require("../lib/logger");
const assert = require("assert");

function readRc(fname) {
  const rcFname = Path.basename(fname);
  try {
    const rcData = Fs.readFileSync(fname).toString();
    let rc;
    try {
      assert(rcFname === ".fynrc" && rcData.startsWith("---"));
      rc = Yaml.parse(rcData);
      logger.debug(`Loaded ${rcFname} YAML RC`, fname, JSON.stringify(rc));
    } catch (e) {
      rc = Ini.parse(rcData);
      logger.debug(`Loaded ${rcFname} ini RC`, fname, JSON.stringify(rc));
    }
    return rc;
  } catch (e) {
    if (e.code !== "ENOENT") {
      logger.error(`Failed to process ${rcFname} RC file`, fname, e.message);
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

  const rc = [
    Path.join(process.env.HOME, ".npmrc"),
    Path.join(process.env.HOME, ".fynrc"),
    Path.join(cwd, ".npmrc"),
    Path.join(cwd, ".fynrc")
  ].map(readRc);

  const merged = _.merge.apply(_, [defaults].concat(rc));

  return merged;
}

module.exports = loadRc;
