/* eslint-disable no-magic-numbers, consistent-return */

import Promise from "bluebird";
import Fs from "fs";
import _ from "lodash";
import ItemQueue from "item-queue";
import VisualExec from "visual-exec";
import logger from "./logger";
import Path from "path";
import chalk from "chalk";
import { isCI } from "./is-ci";
const isWin32 = process.platform.startsWith("win32");

import { locateGlobalFyn, loadConfig } from "./utils";

class Bootstrap {
  _opts;
  _data;
  _errors;
  _pkgDirMap;
  _fyn;
  constructor(data, opts) {
    this._opts = opts;
    this._data = data;

    this._errors = [];
    this._pkgDirMap = {};
    _.each(data.packages, pkg => {
      this._pkgDirMap[pkg.name] = pkg.path;
    });

    loadConfig();

    this._fyn = null;
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
          const depDir = this._pkgDirMap[depName];
          let relPath = Path.relative(pkg.path, depDir);
          if (relPath !== depDir && !relPath.startsWith(".")) {
            relPath = `./${relPath}`;
          }
          if (isWin32) {
            relPath = relPath.replace(/\\/g, "/");
          }
          if (fynDeps[depName] !== relPath) {
            count++;
            fynDeps[depName] = relPath;
          }
        }
      });
      if (!_.isEmpty(fynDeps)) json.fyn[sec] = fynDeps;
    });
    if (count > 0) {
      logger.info(
        "updating package.json with fyn local dependencies for",
        pkg.pkgJson.name,
        "in",
        pkg.path
      );
      Fs.writeFileSync(pkg.pkgFile, `${JSON.stringify(json, null, 2)}\n`);
      return true;
    }
    return false;
  }

  // restorePkgJson() {
  //   _.each(this._data.packages, pkg => {
  //     if (!pkg.ignore) Fs.writeFileSync(pkg.pkgFile, pkg.pkgStr);
  //   });
  // }

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

  async exec({ build = true, fynOpts = [], concurrency = 3, skip = [] }) {
    _.each(this._data.packages, pkg => {
      this.updatePkgToLocal(pkg);
    });

    if (!this._fyn) {
      this._fyn = require.resolve("fyn");
      /* eslint-disable @typescript-eslint/no-var-requires */
      const fynPkgJson = require("fyn/package.json");

      const globalFynInfo = await locateGlobalFyn();
      if (globalFynInfo.dir) {
        if (globalFynInfo.pkgJson.version !== fynPkgJson.version) {
          logger.warn(
            `You have fyn installed globally but its version ${globalFynInfo.pkgJson.version} \
is different from fynpo's internal version ${fynPkgJson.version}`
          );
        } else {
          this._fyn = Path.join(globalFynInfo.dir, globalFynInfo.pkgJson.main);
        }
      }

      logger.info(`Executing fyn with '${process.argv[0]} ${this._fyn}'`);
    }

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

        const fynOptArgs = [process.env.CI ? "--pg simple" : ""]
          .concat(fynOpts, logLevelOpts, `install`, `--no-build-local`)
          .filter(x => x);

        const command = [process.argv[0], this._fyn].concat(fynOptArgs).join(" ");
        const dispCmd = chalk.cyan([`fyn`].concat(fynOptArgs).join(" "));
        logger.debug("bootstrap", name, dispCmd, chalk.blue(item.path));
        const ve = new VisualExec({
          displayTitle: `bootstrap ${name} ${dispCmd}`,
          cwd: item.path,
          command,
          visualLogger: logger
        });

        // eslint-disable-next-line
        ve.logFinalOutput = function (err, output) {};
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
          // return this.restorePkgJson();
        },
        failItem: data => {
          this._errors.push(data);
          // this.restorePkgJson();
        }
      }
    });

    return itemQ.addItems(this.getMoreInstall()).wait();
  }
}

export = Bootstrap;
