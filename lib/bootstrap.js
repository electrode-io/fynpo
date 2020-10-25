"use strict";

/* eslint-disable no-magic-numbers */

const Promise = require("bluebird");
const Fs = require("fs");
const _ = require("lodash");
const ItemQueue = require("item-queue");
const VisualExec = require("visual-exec");
const logger = require("./logger");
const Path = require("path");
const chalk = require("chalk");
const { isCI } = require("./is-ci");
const isWin32 = process.platform.startsWith("win32");

class Bootstrap {
  constructor(data, opts) {
    this._opts = opts;
    this._data = data;
    data.ignores.forEach(x => {
      if (data.packages[x]) {
        data.packages[x].ignore = true;
      } else {
        logger.warn("Ignore package", x, "does not exist");
      }
    });
    if (opts.deps > 0) {
      this.includeDeps(data, opts.deps);
    }
    this._errors = [];
    this._pkgDirMap = {};
    _.each(data.packages, pkg => {
      this._pkgDirMap[pkg.name] = pkg.path;
    });
  }

  includeDeps(data, level) {
    const localDeps = _.uniq(
      Object.keys(data.packages).reduce((acc, p) => {
        if (data.packages[p] && !data.packages[p].ignore) {
          return acc.concat(
            data.packages[p].localDeps.filter(x => data.packages[x] && data.packages[x].ignore)
          );
        }
        return acc;
      }, [])
    );
    if (localDeps.length > 0) {
      localDeps.forEach(p => {
        if (data.packages[p]) {
          data.packages[p].ignore = false;
        }
      });
      level--;
      if (level > 0) {
        this.includeDeps(data, level);
      }
    }
  }

  get failed() {
    return this._errors.length > 0 ? 1 : 0;
  }

  logErrors() {
    if (this._errors.length > 0) {
      _.each(this._errors, data => {
        const item = data.item || {};
        logger.error(`=== Error: fynpo failed bootstrapping ${item.name} at ${item.path}`);
        if (isCI) {
          logger.error(`=== CI detected, dumping the debug logs ===`);
          logger.error(`=== bootstrap ${item.name} failure dump of stdout for CI: ===

${data.error.output.stdout}
`);
          logger.error(`=== bootstrap ${item.name} failure dump of stderr for CI: ===

${data.error.output.stderr}
`);
        } else {
          logger.debug(`=== bootstrap ${item.name} failure dump of stdout: ===

${data.error.output.stdout}
`);
          logger.debug(`=== bootstrap ${item.name} failure dump of stderr: ===

${data.error.output.stderr}
`);
        }
        logger.error(`=== bootstrap ${item.name} error message:`, data.error.message);
        logger.error(`=== END of error info for bootstrapping ${item.name} at ${item.path} ===`);
      });
    }
  }

  install(pkg, queue) {
    if (pkg.ignore) {
      return true;
    }
    if (pkg.installed === "pending") return false;
    if (pkg.installed) return true;

    let pending = 0;

    _.each(pkg.localDeps, depName => {
      if (!this.install(this._data.packages[depName], queue)) pending++;
    });

    if (pending === 0 && !pkg.installed) {
      queue.push(pkg);
      pkg.installed = "pending";
    }

    return false;
  }

  descopePkgName(name) {
    if (name.startsWith("@")) {
      const ix = name.indexOf("/");
      if (ix > 0) {
        return name.substr(ix + 1);
      }
    }
    return name;
  }

  updatePkgToLocal(pkg) {
    if (pkg.ignore) return false;
    const json = pkg.pkgJson;
    if (!json) return false;
    let count = 0;
    ["dependencies", "devDependencies", "optionalDependencies"].forEach(sec => {
      const deps = json[sec];
      if (!deps) return;
      if (!json.fyn) json.fyn = {};
      const fynDeps = json.fyn[sec] || {};
      _.each(pkg.localDeps, depName => {
        if (!this._data.packages[depName].ignore && deps.hasOwnProperty(depName)) {
          count++;
          const depDir = this._pkgDirMap[depName];
          let relPath = Path.relative(pkg.path, depDir);
          if (relPath !== depDir && !relPath.startsWith(".")) {
            relPath = `./${relPath}`;
          }
          if (isWin32) {
            relPath = relPath.replace(/\\/g, "/");
          }
          fynDeps[depName] = relPath;
        }
      });
      if (!_.isEmpty(fynDeps)) json.fyn[sec] = fynDeps;
    });
    if (count > 0) {
      Fs.writeFileSync(pkg.pkgFile, `${JSON.stringify(json, null, 2)}\n`);
      return true;
    }
    return false;
  }

  restorePkgJson() {
    _.each(this._data.packages, pkg => {
      if (!pkg.ignore) Fs.writeFileSync(pkg.pkgFile, pkg.pkgStr);
    });
  }

  getMoreInstall() {
    const queue = [];

    _.each(this._data.packages, pkg => {
      this.install(pkg, queue);
    });

    return queue;
  }

  updateToLocal() {
    _.each(this._data.packages, pkg => {
      if (this.updatePkgToLocal(pkg)) {
        logger.info("Update package", pkg.name, "dependencies to local");
      }
    });
  }

  exec({ build = true, fynOpts = [], concurrency = 3, skip = [] }) {
    _.each(this._data.packages, pkg => {
      this.updatePkgToLocal(pkg);
    });

    const centralDir = Path.resolve(".fynpo/_store");
    logger.info(`Setting env FYN_CENTRAL_DIR to ${centralDir}`);
    process.env.FYN_CENTRAL_DIR = centralDir;
    const start = Date.now();
    const itemQ = new ItemQueue({
      Promise,
      concurrency,
      stopOnError: true,
      processItem: item => {
        const name = chalk.magenta(item.name);
        if (skip && skip.includes(item.name)) {
          logger.info("bootstrap skipping", name);
          return;
        }
        let logLevelOpts = "";
        if (fynOpts.indexOf("-q") < 0 && fynOpts.indexOf("--log-level") < 0) {
          logLevelOpts = "-q d";
        }

        const fynCmd = [`fyn`, process.env.CI ? "--pg simple" : ""]
          .concat(fynOpts)
          .concat(logLevelOpts, "install")
          .filter(x => x)
          .join(" ");

        const getRunBuild = () => {
          const prepare = _.get(item, "pkgJson.scripts.prepare");
          const build2 = _.get(item, "pkgJson.scripts.build");
          return !prepare && build2 && "npm run build";
        };

        const command = [fynCmd, build && getRunBuild()].filter(x => x).join(" && ");
        const dispCmd = chalk.cyan(command);
        logger.debug("bootstrap", name, dispCmd, chalk.blue(item.path));
        const ve = new VisualExec({
          displayTitle: `bootstrap ${name} ${dispCmd}`,
          cwd: item.path,
          command,
          visualLogger: logger
        });

        ve.logFinalOutput = function(err, output) {};
        return ve.execute();
      },
      handlers: {
        doneItem: data => {
          if (data.item) data.item.installed = true;
          const items = this.getMoreInstall();
          itemQ.addItems(items, true);
        },
        done: () => {
          const ts = (Date.now() - start) / 1000;
          logger.info(`bootstrap completed in ${ts}secs`);
          return this.restorePkgJson();
        },
        failItem: data => {
          this._errors.push(data);
          this.restorePkgJson();
        }
      }
    });

    return itemQ.addItems(this.getMoreInstall()).wait();
  }
}

module.exports = Bootstrap;
