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

// replace any ${ENV} values with the appropriate environ.
// copied from https://github.com/npm/config/blob/1f47a6c6ae7864b412d45c6a4a74930cf3365395/lib/env-replace.js

const envExpr = /(?<!\\)(\\*)\$\{([^${}]+)\}/g;

function replaceEnv(f, env) {
  return f.replace(envExpr, (orig, esc, name) => {
    const val = env[name] !== undefined ? env[name] : `$\{${name}}`;

    // consume the escape chars that are relevant.
    if (esc.length % 2) {
      return orig.slice((esc.length + 1) / 2);
    }

    return esc.slice(esc.length / 2) + val;
  });
}

function replaceRcEnv(rc, env) {
  for (const k in rc) {
    if (rc[k] && rc[k].replace) {
      rc[k] = replaceEnv(rc[k], env);
    }
  }
}

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

  replaceRcEnv(all, process.env);
  replaceRcEnv(npmrc, process.env);

  return {
    all,
    npmrc,
    data,
    npmrcData,
    files
  };
}

module.exports = loadRc;
