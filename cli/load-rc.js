"use strict";

const os = require("os");
const Fs = require("fs");
const Path = require("path");
const Yaml = require("yamljs");
const Ini = require("ini");
const _ = require("lodash");
const logger = require("../lib/logger");
const assert = require("assert");
const defaultRc = require("./default-rc");

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

  const homeDir = os.homedir();

  const rc = [
    Path.join(homeDir, ".npmrc"),
    Path.join(homeDir, ".fynrc"),
    Path.join(cwd, ".npmrc"),
    Path.join(cwd, ".fynrc")
  ].map(readRc);

  const merged = _.merge.apply(_, [defaultRc].concat(rc));

  return merged;
}

module.exports = loadRc;
