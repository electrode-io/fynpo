"use strict";

/* eslint-disable no-magic-numbers,no-eval */

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
const VisualLogger = require("visual-logger");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const uniqId = require("./util/uniq-id");

xsh.Promise = Promise;

/*
 * ref: https://github.com/npm/npm/blob/75b462c19ea16ef0d7f943f94ff4d255695a5c0d/lib/utils/lifecycle.js
 * docs: https://docs.npmjs.com/misc/scripts
 *
 */

const ONE_MB = 1024 * 1024;

const getGlobalNodeModules = () => {
  const nodeDir = Path.dirname(process.execPath);
  if (process.platform === "win32") {
    // windows put node binary under <installed_dir>/node.exe
    // and node_modules under <installed_dir>/node_modules
    return Path.join(nodeDir, "node_modules");
  } else {
    // node install on unix put node binary under <installed_dir>/bin/node
    // and node_modules under <installed_dir>/lib/node_modules
    return Path.join(Path.dirname(nodeDir), "lib/node_modules");
  }
};

class LifecycleScripts {
  constructor(options) {
    if (typeof options === "string") {
      options = { dir: options };
    }
    this._fyn = options._fyn || {};
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

  _addNpmPackageConfig(config, env) {
    if (config) {
      Object.keys(config).forEach(x => {
        env[`npm_package_config_${x}`] = config[x];
      });
    }
  }

  // immitate some common npm configs
  _addNpmConfig(config, env) {
    const mapping = {
      fynDir: "cache",
      proxy: "proxy",
      "https-proxy": "https_proxy"
    };
    if (config) {
      Object.keys(mapping).forEach(x => {
        if (config[x]) {
          const npmKey = mapping[x];
          env[`npm_config_${npmKey}`] = config[x];
        }
      });
    }
  }

  makeEnv(override) {
    const env = Object.assign({}, process.env, override);

    xsh.envPath.addToFront(Path.join(getGlobalNodeModules(), "npm/bin/node-gyp-bin"), env);

    if (this._appDir) {
      xsh.envPath.addToFront(Path.join(this._appDir, "node_modules/.bin"), env);
    }

    xsh.envPath.addToFront(Path.join(this._pkgDir, "node_modules/.bin"), env);

    this._addNpmPackageConfig(this._appPkg.config, env);
    this._addNpmPackageConfig(this._pkg.config, env);
    this._addNpmConfig(this._fyn._options, env);

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
      logger.updateItem(item, {
        msg: buf
          .split("\n")
          .map(x => x && x.trim())
          .join(chalk.blue("\\n"))
          .substr(0, 100),
        _save: false,
        _render: false
      });
    }
  }

  _logResult(data) {
    const { child, pkgName, dimPkgName, scriptName } = data;
    const stdout = `stdout_${uniqId()}`;
    const stderr = `stderr_${uniqId()}`;

    logger.addItem({
      name: stdout,
      color: "green",
      display: `=== Running ${scriptName} of ${pkgName}\nstdout`,
      spinner: VisualLogger.spinners[1]
    });
    logger.addItem({ name: stderr, color: "red", display: `stderr` });

    const updateStdout = buf => this._updateDigest(stdout, buf);
    const updateStderr = buf => this._updateDigest(stderr, buf);

    child.stdout.on("data", updateStdout);
    child.stderr.on("data", updateStderr);

    const logResult = (err, output) => {
      logger.removeItem(stdout);
      logger.removeItem(stderr);
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
        env: this.makeEnv({ PWD: this._pkgDir }),
        maxBuffer: ONE_MB
      },
      this._pkg.scripts[name]
    );

    if (!silent) return child.promise;

    return this._logResult({ child, pkgName, dimPkgName, scriptName });
  }
}

module.exports = LifecycleScripts;
