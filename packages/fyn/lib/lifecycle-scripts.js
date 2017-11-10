"use strict";

/* eslint-disable no-magic-numbers */

//
// execute npm scripts
//

const Path = require("path");
const optionalRequire = require("optional-require")(require);
const assert = require("assert");
const xsh = require("xsh");
const logger = require("./logger");
const Promise = require("bluebird");

/*
 * ref: https://github.com/npm/npm/blob/75b462c19ea16ef0d7f943f94ff4d255695a5c0d/lib/utils/lifecycle.js
 * docs: https://docs.npmjs.com/misc/scripts
 *
 */

const ONE_MB = 1024 * 1024;

class LifecycleScripts {
  constructor(options) {
    if (typeof options === "string") {
      options = { pkgDir: options };
    }
    this._pkgDir = options.pkgDir;
    this._pkg = optionalRequire(Path.resolve(this._pkgDir, "package.json"));
    assert(this._pkg, `Unable to load package.json from ${this._pkgDir}`);
    if (!this._pkg.scripts) {
      this._pkg.scripts = {};
    }
  }

  makeEnv() {
    const env = Object.assign({}, process.env);
    const nodeDir = Path.dirname(Path.dirname(process.execPath));
    xsh.envPath.addToFront(Path.join(nodeDir, "lib/node_modules/npm/bin/node-gyp-bin"), env);
    xsh.envPath.addToFront(Path.join(this._pkgDir, "node_modules/.bin"), env);
    if (this._pkg.config) {
      Object.keys(this._pkg.config).forEach(x => {
        env[`npm_config_${x}`] = this._pkg.config[x];
      });
    }
    // env.npm_lifecycle_event = stage;  // TODO
    env.npm_node_execpath = env.NODE = env.NODE || process.execPath;
    env.npm_execpath = require.main.filename;

    return env;
  }

  execute(aliases) {
    const name = Object.keys(this._pkg.scripts || {}).find(x => aliases.indexOf(x) >= 0);

    const promise = Promise.resolve(false);
    if (!name || !this._pkg.scripts.hasOwnProperty(name)) {
      return promise;
    }

    logger.log("executing npm script", name, this._pkg.scripts[name]);
    assert(this._pkg.scripts[name], `No script ${name} found in package.json in ${this._pkgDir}.`);

    return promise.then(() =>
      xsh.exec(
        {
          cwd: this._pkgDir,
          env: this.makeEnv(),
          maxBuffer: ONE_MB
        },
        this._pkg.scripts[name]
      )
    );
  }
}

module.exports = LifecycleScripts;
