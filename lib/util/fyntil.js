"use strict";

/* eslint-disable no-process-exit */

const Fs = require("./file-ops");
const Path = require("path");
const mkdirp = require("mkdirp");

const FYN_IGNORE_FILE = "__fyn_ignore__";

module.exports = {
  exit: function exit(err) {
    process.exit(err ? 1 : 0);
  },
  makeFynLinkFName: pkgName => {
    return `__fyn_link_${pkgName}__.json`.replace(/[@\/]/g, "-");
  },

  createSubNodeModulesDir: dir => {
    const nmDir = Path.join(dir, "node_modules");

    mkdirp.sync(nmDir);
    const fynIgnoreFile = Path.join(nmDir, FYN_IGNORE_FILE);
    if (!Fs.existsSync(fynIgnoreFile)) {
      Fs.writeFileSync(fynIgnoreFile, "");
    }

    return nmDir;
  }
};
