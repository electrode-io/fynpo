/* eslint-disable consistent-return */

import xsh from "xsh";
import Promise from "bluebird";
import logger from "./logger";
import * as utils from "./utils";
import _ from "lodash";
import { npmRunScriptStreaming, npmRunScript } from "./npm-run-script";
import PQueue from "p-queue";

export default class Run {
  _cwd;
  _script;
  _packages;
  _options;
  _args;
  _npmClient;
  _circularMap;

  constructor(opts, args, data) {
    this._script = args.script;
    this._cwd = opts.dir || opts.cwd;
    this._packages = data.packages;
    this._options = opts;
    this._args = this._options["--"] || [];
    this._npmClient = "npm";
    this._circularMap = {};
    data.circulars.reduce((mapping, locks) => {
      locks.forEach((name) => (mapping[name] = locks));
      return mapping;
    }, this._circularMap);
  }

  _sh(command, cwd = this._cwd, silent = true) {
    return xsh.exec(
      {
        silent,
        cwd,
        env: Object.assign({}, process.env, { PWD: cwd }),
      },
      command
    );
  }

  getOpts(pkg) {
    return {
      args: this._args,
      npmClient: this._npmClient,
      prefix: this._options.prefix,
      reject: this._options.bail,
      pkg,
    };
  }

  excuteScript(pkg, pkgQueue) {
    if (pkg.ignore) {
      return true;
    }

    if (pkg.executed === "pending") return false;
    if (pkg.executed) return true;

    let pending = 0;

    _.each(pkg.localDeps, (depName) => {
      const depPkg = this._packages[depName] || {};
      const scriptToRun = _.get(depPkg, ["pkgJson", "scripts", this._script]);
      const circulars = this._circularMap[depName] || [];
      if (
        scriptToRun &&
        !circulars.includes(pkg.name) &&
        !this.excuteScript(depPkg, pkgQueue)
      ) {
        pending++;
      }
    });

    if (pending === 0 && !pkg.executed) {
      pkg.executed = "pending";
      pkgQueue.push(pkg);
    }

    return false;
  }

  getRunner() {
    return this._options.stream
      ? (pkg) => this.runScriptWithStream(pkg)
      : (pkg) => this.runScript(pkg);
  }

  runScript(pkg) {
    const timer = utils.timer();
    return npmRunScript(this._script, this.getOpts(pkg)).then((result) => {
      const duration = (timer() / 1000).toFixed(1);
      logger.info(result.stdout);
      logger.info(`Ran npm script ${this._script} in ${pkg.name} in ${duration}s:"`);
      return result;
    });
  }

  runScriptWithStream(pkg) {
    return npmRunScriptStreaming(this._script, this.getOpts(pkg));
  }

  runScriptsInLexical(packagesToRun) {
    return Promise.map(packagesToRun, this.getRunner(), { concurrency: this._options.concurrency });
  }

  runScriptsInParallel(packagesToRun) {
    return Promise.map(packagesToRun, (pkg) => this.runScriptWithStream(pkg));
  }

  runScriptsInTopological(packagesToRun) {
    const runner = this.getRunner();

    const queue = new PQueue({ concurrency: this._options.concurrency });
    return new Promise((resolve, reject) => {
      const returnValues = [];

      const queueNextAvailablePackages = () => {
        const pkgQueue = [];

        packagesToRun.forEach((pkg) => {
          this.excuteScript(pkg, pkgQueue);
        });

        pkgQueue.forEach((pkg) => {
          queue
            .add(() =>
              runner(pkg)
                .then((value) => returnValues.push(value))
                .then(() => (pkg.executed = true))
                .then(() => queueNextAvailablePackages())
            )
            .catch(reject);
        });
      };

      queueNextAvailablePackages();

      return queue.onIdle().then(() => resolve(returnValues));
    });
  }

  exec() {
    if (!this._script) {
      logger.error("You must specify a lifecycle script to run!");
      process.exit(1);
    }
    const packagesToRun = Object.values(this._packages).filter((pkg: any) => {
      const scriptToRun = _.get(pkg, ["pkgJson", "scripts", this._script]);
      return scriptToRun && !pkg.ignore;
    });

    const count = packagesToRun.length;

    if (!count) {
      logger.info(`No packages found with script ${this._script}`);
      return;
    }

    const joinedCommand = [this._npmClient, "run", this._script].concat(this._args).join(" ");
    const pkgMsg = count === 1 ? "package" : "packages";

    logger.info(`Executing command ${joinedCommand} in ${count} ${pkgMsg}`);
    const timer = utils.timer();

    return Promise.resolve()
      .then(() => {
        if (this._options.parallel) {
          return this.runScriptsInParallel(packagesToRun);
        } else if (this._options.sort) {
          return this.runScriptsInTopological(packagesToRun);
        } else {
          return this.runScriptsInLexical(packagesToRun);
        }
      })
      .then((results) => {
        if (results.some((result) => result.failed)) {
          // propagate "highest" error code, it's probably the most useful
          const codes = results.filter((result) => result.failed).map((result) => result.exitCode);
          const exitCode = Math.max(...codes, 1);

          logger.error(`Received non-zero exit code ${exitCode} during execution`);
          process.exitCode = exitCode;
        }
      })
      .then(() => {
        const duration = (timer() / 1000).toFixed(1);
        const messages = packagesToRun.map((pkg: any) => ` - ${pkg.name}`);
        logger.info(
          `Ran npm script ${this._script} in ${count} ${pkgMsg} in ${duration}s:\n${messages.join(
            "\n"
          )}`
        );
      })
      .catch((err) => {
        process.exitCode = err.exitCode;
        throw err;
      });
  }
}
