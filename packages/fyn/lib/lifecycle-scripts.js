"use strict";

/* eslint-disable no-magic-numbers */

//
// execute npm scripts
//

const Path = require("path");
const optionalRequire = require("optional-require")(require);
const assert = require("assert");
const xsh = require("xsh");
const Promise = require("bluebird");
const chalk = require("chalk");
const _ = require("lodash");
const logger = require("./logger");
const logFormat = require("./util/log-format");

xsh.Promise = Promise;

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
    this._pkgDir = options.dir;
    if (options.appDir && options.appDir !== options.dir) {
      this._appDir = options.appDir;
      this._appPkg = optionalRequire(Path.join(this._appDir, "package.json"), { default: {} });
    } else {
      this._appPkg = {};
    }

    this._pkg = options.json || optionalRequire(Path.resolve(this._pkgDir, "package.json"));
    assert(this._pkg, `Unable to load package.json from ${this._pkgDir}`);
    if (!this._pkg.scripts) {
      this._pkg.scripts = {};
    }
  }

  _addNpmConfig(config, env) {
    if (config) {
      Object.keys(config).forEach(x => {
        env[`npm_config_${x}`] = this._pkg.config[x];
      });
    }
  }

  makeEnv() {
    const env = Object.assign({}, process.env);
    const nodeDir = Path.dirname(Path.dirname(process.execPath));
    xsh.envPath.addToFront(Path.join(nodeDir, "lib/node_modules/npm/bin/node-gyp-bin"), env);
    if (this._appDir) {
      xsh.envPath.addToFront(Path.join(this._appDir, "node_modules/.bin"), env);
    }
    xsh.envPath.addToFront(Path.join(this._pkgDir, "node_modules/.bin"), env);
    this._addNpmConfig(this._appPkg.config, env);
    this._addNpmConfig(this._pkg.config, env);

    // env.npm_lifecycle_event = stage;  // TODO

    env.npm_node_execpath = env.NODE = env.NODE || process.execPath;
    env.npm_execpath = require.main.filename;

    return env;
  }

  execute(aliases, silent) {
    return Promise.try(() => this._execute(aliases, silent));
  }

  /* eslint-disable max-statements */
  _updateDigest(item, buf) {
    buf = buf && buf.trim();
    if (buf) {
      logger.updateItem(
        item,
        buf
          .split("\n")
          .map(x => x && x.trim())
          .join(chalk.blue("\\n"))
          .substr(0, 100)
      );
    }
  }

  _logResult(data) {
    const { child, pkgName, dimPkgName, scriptName } = data;
    const stdout = `stdout_${Date.now()}`;
    const stderr = `stderr_${Date.now()}`;

    logger.addItem({ name: stdout, color: "green", display: `${pkgName} stdout` });
    logger.addItem({ name: stderr, color: "red", display: `${pkgName} stderr` });

    const updateStdout = buf => this._updateDigest(stdout, buf);
    const updateStderr = buf => this._updateDigest(stderr, buf);

    child.stdout.on("data", updateStdout);
    child.stderr.on("data", updateStderr);

    const logResult = (err, output) => {
      logger.remove(stdout);
      logger.remove(stderr);
      child.stdout.removeListener("data", updateStdout);
      child.stderr.removeListener("data", updateStderr);

      const result = err ? `failed ${chalk.red(err.message)}` : chalk.green("exit code 0");

      const info = () => (err ? "error" : "info");
      const verbose = () => (err ? "error" : "verbose");

      if (err) {
        output = err.output;
      }

      logger[info()](`executed ${pkgName} npm script ${scriptName} ${result}`);

      const colorize = t => t.replace(/ERR!/g, chalk.red("ERR!"));

      const logOutput = () => {
        const logs = [chalk.green(">>>")];
        logs.push(`Start of output from ${dimPkgName} npm script ${scriptName} ===`);

        if (output.stdout) logs.push(`\n${colorize(output.stdout)}`);
        if (output.stderr) {
          logs.push(chalk.red("\n=== stderr ===\n") + colorize(output.stderr));
        }
        logs.push(chalk.blue("\n<<<"));
        logs.push(`End of output from ${dimPkgName} npm script ${scriptName} ---`);
        logger.prefix(false)[verbose()].apply(logger, logs);
      };

      if (!output || (!output.stdout && !output.stderr)) {
        logger[verbose()](
          `${chalk.green("No output")} from ${dimPkgName} npm script ${scriptName}`
        );
      } else {
        logOutput();
      }
    };

    return child.promise.tap(output => logResult(null, output)).catch(err => {
      logResult(err);
      throw err;
    });
  }

  _execute(aliases, silent) {
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
    const pkgDir = logFormat.pkgPath(this._pkg.name, this._pkgDir);

    logger.verbose(`executing ${dimPkgName} npm script ${scriptName} ${script} ${pkgDir}`);

    const child = xsh.exec(
      {
        silent,
        cwd: this._pkgDir,
        env: this.makeEnv(),
        maxBuffer: ONE_MB
      },
      this._pkg.scripts[name]
    );

    if (!silent) return child.promise;

    return this._logResult({ child, pkgName, dimPkgName, scriptName });
  }
}

module.exports = LifecycleScripts;
