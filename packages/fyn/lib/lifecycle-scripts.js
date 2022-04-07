"use strict";

/* eslint-disable no-magic-numbers, max-statements, no-eval, camelcase, no-param-reassign */

//
// execute npm scripts
//

const Path = require("path");
const optionalRequire = require("optional-require")(eval("require"));
const assert = require("assert");
const xsh = require("xsh");
const Promise = require("bluebird");
const chalk = require("chalk");
const _ = require("lodash");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const VisualExec = require("visual-exec");
const fyntil = require("./util/fyntil");
const requireAt = require("require-at");
const { setupNodeGypEnv } = require("./util/setup-node-gyp");

const npmConfigEnv = require("./util/npm-config-env");
const { AggregateError } = require("@jchip/error");

const readPkgJson = dir => {
  return fyntil.readPkgJson(dir).catch(() => {
    return {};
  });
};

xsh.Promise = Promise;

// When released, all code are bundled into dist/fyn.js
// When running from original source, this is under lib/lifecycle-scripts.js
// It's important to maintain same level so "../package.json" works.
const fynInstalledDir = Path.dirname(optionalRequire.resolve("../package.json"));
const fynCli = requireAt(fynInstalledDir).resolve("./bin/fyn.js");

/*
 * ref: https://github.com/npm/npm/blob/75b462c19ea16ef0d7f943f94ff4d255695a5c0d/lib/utils/lifecycle.js
 * docs: https://docs.npmjs.com/misc/scripts
 *
 */

const ONE_MB = 1024 * 1024;

class LifecycleScripts {
  constructor(options) {
    if (typeof options === "string") {
      options = { dir: options };
    }
    this._fyn = options._fyn || {};
    this._pkgDir = options.dir;
    this._options = Object.assign({}, options);
  }

  makeEnv(override) {
    // let env = Object.assign({}, process.env, override);
    // this._addNpmPackageConfig(this._appPkg.config, env);
    // this._addNpmPackageConfig(this._pkg.config, env);

    const env = Object.assign({}, npmConfigEnv(this._pkg, this._fyn.allrc || {}), override);

    setupNodeGypEnv(env);

    // add fynpo node_modules/.bin to PATH
    if (this._fyn.isFynpo) {
      xsh.envPath.addToFront(Path.join(this._fyn._fynpo.dir, "node_modules/.bin"), env);
    }

    if (this._appDir) {
      xsh.envPath.addToFront(Path.join(this._appDir, "node_modules/.bin"), env);
    }
    xsh.envPath.addToFront(Path.join(this._pkgDir, "node_modules/.bin"), env);

    // env.npm_lifecycle_event = stage;  // TODO

    env.npm_node_execpath = env.NODE = env.NODE || process.execPath;
    env.npm_execpath = fynCli;
    env.INIT_CWD = this._fyn.cwd;

    return env;
  }

  execute(aliases, silent) {
    return Promise.try(() => this._execute(aliases, silent));
  }

  async _initialize() {
    const options = this._options;
    if (options.appDir && options.appDir !== options.dir) {
      this._appDir = options.appDir;
      this._appPkg = await readPkgJson(this._appDir);
    } else {
      this._appPkg = {};
    }

    this._pkg = options.json || (await readPkgJson(this._pkgDir));
    assert(this._pkg, `Unable to load package.json from ${this._pkgDir}`);
    if (!this._pkg.scripts) {
      this._pkg.scripts = {};
    }
  }

  async _execute(aliases, silent) {
    if (!this._pkg) {
      await this._initialize();
    }

    if (typeof aliases === "string") aliases = [aliases];

    const name = _.keys(this._pkg.scripts).find(x => aliases.indexOf(x) >= 0);

    if (!name || !this._pkg.scripts.hasOwnProperty(name)) {
      return false;
    }

    assert(
      this._pkg.scripts[name],
      `No npm script ${name} found in package.json in ${this._pkgDir}.`
    );

    const pkgName = logFormat.pkgId(this._pkg);
    const dimPkgName = chalk.dim(pkgName);
    const scriptName = chalk.magenta(name);
    const script = `"${chalk.cyan(this._pkg.scripts[name])}"`;
    const pkgDir = logFormat.pkgPath(this._pkg.name, this._pkgDir.replace(this._fyn.cwd, "."));

    const env = this.makeEnv({ PWD: this._pkgDir });

    logger.verbose(
      `running npm script '${scriptName}' of ${dimPkgName}: ${script} - at dir ${pkgDir}`
    );

    const child = xsh.exec(
      {
        silent,
        cwd: this._pkgDir,
        env,
        maxBuffer: 20 * ONE_MB
      },
      this._pkg.scripts[name]
    );

    // exec not silent so it's dumping to stdout
    // and it's not a good idea to try to show visual progress of the execution
    if (!silent) {
      return child.promise;
    }

    const ve = new VisualExec({
      command: this._pkg.scripts[name],
      cwd: this._pkgDir,
      visualLogger: logger,
      displayTitle: `Running ${scriptName} of ${pkgName}`,
      logLabel: `${pkgName} npm script ${scriptName}`,
      outputLabel: `${dimPkgName} npm script ${scriptName}`
    });

    try {
      return await ve.show(child);
    } catch (err) {
      throw new AggregateError(
        [err],
        `Failed running npm script '${name}' for package ${pkgName} at ${pkgDir}`
      );
    }
  }
}

module.exports = LifecycleScripts;
