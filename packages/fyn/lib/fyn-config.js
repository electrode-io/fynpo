"use strict";

const _ = require("lodash");
const Path = require("path");
const xenvConfig = require("xenv-config");

const spec = {
  registry: { env: "FYN_REGISTRY", default: "http://localhost:4873" },
  pkgFile: { env: "FYN_PACKAGE_FILE", default: "package.json" },
  targetDir: { env: "FYN_TARGET_DIR", default: "xout" },
  fynDir: {
    env: ["FYN_DIR", "USERPROFILE", "HOME"],
    default: process.cwd(),
    post: (v, t) => {
      if ((t.src === "env" && t.name !== "FYN_DIR") || t.src === "default") {
        return Path.join(v, ".fyn");
      }
      return v;
    }
  }
};

module.exports = function fynConfig(override) {
  const configKeys = Object.keys(spec);
  const userConfig = _.pick(override, configKeys);
  const config = xenvConfig(spec, userConfig, { sources: ["option", "env"] });
  config.fynCacheDir = Path.join(config.fynDir, "_cacache");
  config.lockfile = true;

  return Object.assign(config, _.omit(override, configKeys));
};
