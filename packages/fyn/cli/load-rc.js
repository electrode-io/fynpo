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
const npmConfig = require("./config/npm-config");
const fynTil = require("../lib/util/fyntil");

function readRc(fname) {
  const rcFname = Path.basename(fname);

  try {
    const rcData = Fs.readFileSync(fname).toString();
    let rc;

    try {
      assert(rcFname === ".fynrc" && rcData.startsWith("---"));
      rc = Yaml.parse(rcData);
      logger.debug(`Loaded ${rcFname} YAML RC`, fname, JSON.stringify(fynTil.removeAuthInfo(rc)));
    } catch (e) {
      rc = Ini.parse(rcData);
      logger.debug(`Loaded ${rcFname} ini RC`, fname, JSON.stringify(fynTil.removeAuthInfo(rc)));
    }

    return rc;
  } catch (e) {
    if (e.code !== "ENOENT") {
      logger.error(`Failed to process ${rcFname} RC file`, fname, e.message);
    }
    return {};
  }
}

function loadRc(cwd, fynpoDir) {
  const npmrcData = [];

  if (cwd === false) {
    return {
      npmrc: {}
    };
  }

  const homeDir = os.homedir();

  const files = [
    process.env.NPM_CONFIG_GLOBALCONFIG,
    Path.join(process.env.PREFIX || "", "/etc/npmrc"),
    process.env.NPM_CONFIG_USERCONFIG,
    Path.join(homeDir, ".npmrc"),
    Path.join(homeDir, ".fynrc"),

    // fynpo dir
    fynpoDir && fynpoDir !== cwd && Path.join(fynpoDir, ".npmrc"),
    fynpoDir && fynpoDir !== cwd && Path.join(fynpoDir, ".fynrc"),

    Path.join(cwd, ".npmrc"),
    Path.join(cwd, ".fynrc")
  ].filter(x => x);

  const data = files.map(fp => {
    const x = readRc(fp);
    if (fp.endsWith("npmrc")) {
      npmrcData.push(x);
    }
    return x;
  });

  const all = _.merge.apply(_, [{}, npmConfig.defaults, defaultRc].concat(data));
  const npmrc = _.merge.apply(_, [{}, npmConfig.defaults].concat(npmrcData));

  return {
    all,
    npmrc,
    data,
    npmrcData,
    files
  };
}

module.exports = loadRc;
