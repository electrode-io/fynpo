"use strict";

/* eslint-disable no-process-exit, max-params */
/* eslint-disable no-magic-numbers,max-statements,prefer-template */

const Fs = require("./file-ops");
const Path = require("path");
const logger = require("../logger");
const Promise = require("bluebird");
const mississippi = require("mississippi");
const missPipe = Promise.promisify(mississippi.pipe, { context: mississippi });
const { PACKAGE_RAW_INFO } = require("../symbols");

const isWin32 = process.platform === "win32";

const DIR_SYMLINK_TYPE = isWin32 ? "junction" : "dir";

function retry(func, checks, tries, wait) {
  return Promise.try(func).catch(err => {
    if (tries <= 0) throw err;
    tries--;
    return Promise.try(() =>
      Array.isArray(checks) ? checks.indexOf(err.code) >= 0 : checks(err)
    ).then(canRetry => {
      if (!canRetry) throw err;
      return Promise.delay(wait).then(() => retry(func, checks, tries, wait));
    });
  });
}

const checkFiltering = (rules, userValue) => {
  if (!rules || rules.length === 0) {
    return true;
  }

  const denies = rules.filter(x => x[0] === "!");

  // explicitly deny value immediately fails
  if (denies.indexOf(`!${userValue}`) >= 0) {
    return false;
  }

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

module.exports = {
  missPipe,

  retry,

  exit: function exit(err) {
    process.exit(err ? 1 : 0);
  },

  makeFynLinkFName: pkgName => {
    return `__fyn_link_${pkgName}__.json`.replace(/[@\/]/g, "-");
  },

  readJson(file) {
    return Fs.readFile(file, "utf8").then(JSON.parse);
  },

  readPkgJson: (dir, keepRaw) => {
    const isDir = !dir.endsWith(".json");
    return Fs.readFile(isDir ? Path.join(dir, "package.json") : dir, "utf8").then(str => {
      const json = JSON.parse(str.trim());
      if (keepRaw) {
        json[PACKAGE_RAW_INFO] = {
          dir: isDir ? dir : Path.dirname(dir),
          str
        };
      }
      return json;
    });
  },

  symlinkDir: async (linkName, targetName) => {
    await Fs.symlink(targetName, linkName, DIR_SYMLINK_TYPE);
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
  validateExistSymlink: async (symlinkDir, targetPath) => {
    let existTarget;
    //
    // Check if the dir already exist and try to read it as a symlink
    //
    try {
      existTarget = await Fs.readlink(symlinkDir);
      if (DIR_SYMLINK_TYPE === "junction" && !Path.isAbsolute(targetPath)) {
        targetPath = Path.join(symlinkDir, "..", targetPath) + "\\";
      }
    } catch (e) {
      existTarget = e.code !== "ENOENT";
    }

    // If it exist but doesn't match targetDir
    if (existTarget && existTarget !== targetPath) {
      logger.debug("local link exist", existTarget, "not match new one", targetPath);
      // remove exist target so a new one can be created
      existTarget = false;
      try {
        // try to unlink it as a symlink/file first
        await Fs.unlink(symlinkDir);
      } catch (e) {
        // else remove the directory
        await Fs.$.rimraf(symlinkDir);
      }
    } else {
      logger.debug("local link existTarget", existTarget, "match new target", targetPath);
    }

    return existTarget;
  },

  checkFiltering,

  checkPkgOsCpu: pkg => {
    if (pkg.hasOwnProperty("os") && !checkFiltering(pkg.os, process.platform)) {
      return `your platform ${process.platform} doesn't satisfy required os ${pkg.os}`;
    }

    if (pkg.hasOwnProperty("cpu") && !checkFiltering(pkg.cpu, process.arch)) {
      return `your cpu/arch ${process.arch} doesn't satisfy required cpu ${pkg.cpu}`;
    }

    return true;
  }
};
