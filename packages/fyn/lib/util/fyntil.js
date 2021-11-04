"use strict";

/* eslint-disable no-process-exit, max-params */
/* eslint-disable no-magic-numbers,max-statements,prefer-template */

const Fs = require("./file-ops");
const _ = require("lodash");
const Path = require("path");
const logger = require("../logger");
const Promise = require("bluebird");
const mississippi = require("mississippi");
const missPipe = Promise.promisify(mississippi.pipe, { context: mississippi });
const { PACKAGE_RAW_INFO } = require("../symbols");
const { PACKAGE_FYN_JSON } = require("../constants");
const { FynpoConfigManager, FynpoDepGraph } = require("@fynpo/base");

/* eslint-disable no-magic-numbers, max-statements, no-empty, complexity, no-eval */

const { isWin32, retry } = require("./base-util");

const DIR_SYMLINK_TYPE = isWin32 ? "junction" : "dir";

/**
 * Check if a value satisfy a list of rules.
 *
 * Mainly to check package.json os and cpu per https://docs.npmjs.com/cli/v6/configuring-npm/package-json#os
 *
 * @param {*} rules the rules
 * @param {*} userValue value to check
 *
 * @returns true|false
 */
const checkValueSatisfyRules = (inRules, userValue) => {
  const rules = [].concat(inRules).filter(x => x);

  // no rules means satisfied
  if (!rules || rules.length === 0) {
    return true;
  }

  // any rule starts with ! means deny the value
  const denies = rules.filter(x => x[0] === "!");

  // any value that's denied would fail immediately
  if (denies.indexOf(`!${userValue}`) >= 0) {
    return false;
  }

  // rules that accepts a value
  const accepts = rules.filter(x => x[0] !== "!");

  // if no explicitly spelled out values to accept then anything not denied
  // is accepted.
  if (accepts.length === 0) {
    return true;
  }

  // explicitly accept value immediately satisfies
  if (rules.indexOf(userValue) >= 0) {
    return true;
  }

  // finally not satisfies
  return false;
};

/**
 * If system path sep is not /, then convert a path to use /.
 */
const posixify = Path.sep === "/" ? x => x : x => x.replace(/\\/g, "/");

const fyntil = {
  isWin32,

  missPipe,

  retry,

  fynpoConfig: undefined,

  resetFynpo() {
    fyntil.fynpoConfig = undefined;
  },

  async loadFynpo(cwd = process.cwd()) {
    if (fyntil.fynpoConfig) {
      return fyntil.fynpoConfig;
    }
    const fcm = new FynpoConfigManager({ cwd });
    const config = await fcm.load();

    if (config) {
      logger.info(`Detected a ${fcm.repoType} at ${fcm.topDir}`);
      const opts = { cwd: fcm.topDir };
      if (config.hasOwnProperty("packages")) {
        opts.patterns = config.packgaes;
      }
      const graph = new FynpoDepGraph(opts);
      await graph.resolve();

      return (fyntil.fynpoConfig = {
        config,
        dir: fcm.topDir,
        graph,
        indirects: []
      });
    } else {
      return (fyntil.fynpoConfig = {});
    }
  },

  removeAuthInfo(rcObj) {
    const rmObj = {};
    for (const key in rcObj) {
      const lower = key.toLowerCase();
      if (!lower.includes("auth") && !lower.includes("password") && !lower.includes("otp")) {
        rmObj[key] = rcObj[key];
      }
    }

    return rmObj;
  },

  exit(err) {
    process.exit(err ? 1 : 0);
  },

  async readJson(file, defaultData) {
    try {
      const data = await Fs.readFile(file, "utf8");
      return JSON.parse(data);
    } catch (err) {
      if (err.code !== "ENOENT") {
        const msg = `Failed to read JSON file ${file} - ${err.message}`;
        logger.error(msg);
        throw new Error(msg);
      }

      if (defaultData !== undefined) {
        return defaultData;
      }

      throw err;
    }
  },

  relativePath(from, to, shouldPosixify = false) {
    const rel = Path.relative(from, to);
    if (!Path.isAbsolute(rel) && !rel.startsWith(".")) {
      return `.${Path.sep}${rel}`;
    }
    return shouldPosixify ? posixify(rel) : rel;
  },

  async readPkgJson(dirOrFile, keepRaw, packageFyn = false) {
    const isDir = !dirOrFile.endsWith(".json");
    const dir = isDir ? dirOrFile : Path.dirname(dirOrFile);
    const files = ["package.json", packageFyn && PACKAGE_FYN_JSON].filter(x => x);
    const finalJson = {};
    for (const fname of files) {
      const file = Path.join(dir, fname);
      try {
        const str = await Fs.readFile(file, "utf8");
        const json = JSON.parse(str.trim());
        _.merge(finalJson, json);
        if (keepRaw && fname !== PACKAGE_FYN_JSON) {
          finalJson[PACKAGE_RAW_INFO] = { dir, str };
        }
      } catch (err) {
        if (fname !== PACKAGE_FYN_JSON || err.code !== "ENOENT") {
          throw new Error(`Failed Reading ${file}: ${err.message}`);
        }
      }
    }
    return finalJson;
  },

  symlinkDir: async (linkName, targetName, relative = false) => {
    await Fs.symlink(
      relative && Path.isAbsolute(targetName)
        ? Path.relative(Path.dirname(linkName), targetName)
        : targetName,
      linkName,
      DIR_SYMLINK_TYPE
    );
  },

  symlinkFile: async (linkName, targetName) => {
    if (isWin32) {
      // Windows symlink require admin permission
      // And Junction is only for directories
      // Too bad, just make a hard link.
      await Fs.link(targetName, linkName);
    } else {
      await Fs.symlink(targetName, linkName);
    }
  },

  //
  // - check if symlink exist, if not, return false
  // - make sure a existing symlink points to targetPath
  // - if not, remove it, return false
  // - finally return true
  //
  validateExistSymlink: async (linkName, targetPath, relative = false) => {
    let actualTarget;
    let existTarget;
    //
    // Check if the dir already exist and try to read it as a symlink
    //
    try {
      existTarget = await Fs.readlink(linkName);
      const absoluteTarget = Path.isAbsolute(targetPath);
      if (DIR_SYMLINK_TYPE === "junction" && !absoluteTarget) {
        actualTarget = targetPath = Path.join(linkName, "..", targetPath) + "\\";
      } else {
        actualTarget =
          relative && absoluteTarget
            ? Path.relative(Path.dirname(linkName), targetPath)
            : targetPath;
      }
    } catch (e) {
      existTarget = e.code !== "ENOENT";
    }

    // If it exist but doesn't match targetDir
    if (existTarget && existTarget !== actualTarget) {
      logger.debug("local link exist", existTarget, "not match new one", actualTarget);
      // remove exist target so a new one can be created
      existTarget = false;
      try {
        // try to unlink it as a symlink/file first
        await Fs.unlink(linkName);
      } catch (e) {
        // else remove the directory
        await Fs.$.rimraf(linkName);
      }
    } else {
      logger.debug("local link existTarget", existTarget, "match new target", actualTarget);
    }

    return existTarget;
  },

  checkValueSatisfyRules,

  shaToIntegrity(ss) {
    if (!ss) {
      return undefined;
    }
    if (ss.startsWith("sha")) {
      return ss;
    }
    return `sha1-${Buffer.from(ss, "hex").toString("base64")}`;
  },

  distIntegrity(dist) {
    if (dist.integrity) {
      return dist.integrity;
    }
    return fyntil.shaToIntegrity(dist.shasum);
  },

  checkPkgOsCpu: pkg => {
    if (pkg.hasOwnProperty("os") && !checkValueSatisfyRules(pkg.os, process.platform)) {
      return `your platform ${process.platform} doesn't satisfy required os ${pkg.os}`;
    }

    if (pkg.hasOwnProperty("cpu") && !checkValueSatisfyRules(pkg.cpu, process.arch)) {
      return `your cpu/arch ${process.arch} doesn't satisfy required cpu ${pkg.cpu}`;
    }

    return true;
  },

  posixify
};

module.exports = fyntil;
