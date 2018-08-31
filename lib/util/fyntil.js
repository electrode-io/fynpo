"use strict";

/* eslint-disable no-process-exit */
/* eslint-disable no-magic-numbers,max-statements,prefer-template */

const Fs = require("./file-ops");
const Path = require("path");
const logger = require("../logger");

const isWin32 = process.platform === "win32";

const DIR_SYMLINK_TYPE = isWin32 ? "junction" : "dir";

const FYN_IGNORE_FILE = "__fyn_ignore__";

module.exports = {
  exit: function exit(err) {
    process.exit(err ? 1 : 0);
  },

  makeFynLinkFName: pkgName => {
    return `__fyn_link_${pkgName}__.json`.replace(/[@\/]/g, "-");
  },

  readPkgJson: dir => {
    return Fs.readFile(Path.join(dir, "package.json"), "utf8")
      .then(x => x.trim())
      .then(JSON.parse);
  },

  createSubNodeModulesDir: async dir => {
    const nmDir = Path.join(dir, "node_modules");

    await Fs.$.mkdirp(nmDir);
    const fynIgnoreFile = Path.join(nmDir, FYN_IGNORE_FILE);
    if (!(await Fs.exists(fynIgnoreFile))) {
      await Fs.writeFile(fynIgnoreFile, "");
    }

    return nmDir;
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
  }
};
