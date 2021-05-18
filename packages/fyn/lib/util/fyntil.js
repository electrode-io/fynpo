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
const glob = require("glob");
const pGlob = Promise.promisify(glob);

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

module.exports = {
  missPipe,

  retry,

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

  readJson(file) {
    return Fs.readFile(file, "utf8").then(JSON.parse);
  },

  relativePath(from, to, shouldPosixify = false) {
    const rel = Path.relative(from, to);
    if (!Path.isAbsolute(rel) && !rel.startsWith(".")) {
      return `.${Path.sep}${rel}`;
    }
    return shouldPosixify ? posixify(rel) : rel;
  },

  /**
   * Take an array of glob patterns for a mono-repo's packages and search for
   * all package.json file, and return these directories, with the content of
   * package.json.
   *
   * @param {*} packageGlobs - glob patterns for the packages
   * @param {*} readPkg - true to read package.json
   * @param {*} cwd - dir to start searching
   *
   * @returns monorepo's packages dirs
   */
  async loadFynpoPackages(packageGlobs = ["packages/*"], readPkg = true, cwd = process.cwd()) {
    const packages = {};

    const options = { cwd, strict: true, absolute: true };
    for (const pattern of packageGlobs) {
      const entries = await pGlob(Path.join(pattern, "package.json"), options);

      for (const entry of entries) {
        // glob always uses '/', even on windows, so normalize it
        const normalizePath = Path.normalize(entry);
        const pkgDir = Path.dirname(normalizePath);
        const pkgJson = readPkg ? JSON.parse(await Fs.readFile(normalizePath)) : {};
        packages[pkgDir] = {
          pkgDir,
          normalizePath,
          pkgJson
        };
      }
    }

    return packages;
  },

  async makeFynpoPackagesByName(packages) {
    const packagesByName = {};
    for (const dir in packages) {
      const pkg = packages[dir];
      if (!pkg.pkgJson) {
        pkg.pkgJson = JSON.parse(await Fs.readFile(pkg.normalizePath));
      }
      packagesByName[pkg.pkgJson.name] = pkg;
    }

    return packagesByName;
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
