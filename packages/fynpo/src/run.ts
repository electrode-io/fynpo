/* reuses some of the awesome work from https://github.com/lerna/lerna/blob/main/commands/run/index.js */
/* eslint-disable consistent-return */

import xsh from "xsh";
import Promise from "bluebird";
import logger from "./logger";
import * as utils from "./utils";
import _ from "lodash";
import { npmRunScriptStreaming, npmRunScript } from "./npm-run-script";
import PQueue from "p-queue";
import boxen from "boxen";
import chalk from "chalk";

export default class Run {
  _cwd;
  _script;
  _packages;
  _options;
  _args;
  _npmClient;
  _circularMap;
  _concurrency: number;

  constructor(opts, args, data) {
    this._script = args.script;
    this._cwd = opts.dir || opts.cwd;
    this._packages = data.packages;
    this._options = opts;
    this._args = this._options["--"] || [];
    this._npmClient = "npm";
    this._circularMap = {};
    // enforce concurrency to be an integer between 1 and 10, else default to 3
    this._concurrency =
      Number.isInteger(opts.concurrency) && opts.concurrency >= 1 && opts.concurrency <= 10
        ? opts.concurrency
        : 3;
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

  executeScript(pkg, pkgQueue) {
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
      if (scriptToRun && !circulars.includes(pkg.name) && !this.executeScript(depPkg, pkgQueue)) {
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
    return npmRunScript(this._script, this.getOpts(pkg));
  }

  runScriptWithStream(pkg) {
    return npmRunScriptStreaming(this._script, this.getOpts(pkg));
  }

  runScriptsInLexical(packagesToRun) {
    return Promise.map(packagesToRun, this.getRunner(), { concurrency: this._concurrency });
  }

  _logQueueMsg(pkg) {
    const msg = boxen(`Queueing package ${pkg.name} to run script '${this._script}'`, {
      padding: { top: 0, right: 2, left: 2, bottom: 0 },
    });

    msg.split("\n").forEach((l) => logger.prefix(false).info(l));
  }

  _logRunResult({ timer, error, output, pkg }) {
    const duration = (timer() / 1000).toFixed(1);
    const m1 = error ? "ERROR - Failed" : "Completed";
    const m2 = `${m1} run script '${this._script}' for package ${pkg.name}.  Time: ${duration}s`;
    const m3 = `${this._options.stream ? "" : "\nOutput follows:"}`;
    const m4 = `${m2}${m3}`;
    const msg = boxen(error ? chalk.red(m4) : chalk.green(m4), {
      padding: { top: 0, right: 2, left: 2, bottom: 0 },
    });

    // some build system needs logging one line at a time
    msg.split("\n").forEach((l) => logger.prefix(false).info(l));
    if (!this._options.stream) {
      // TODO: use an exec that interleaves stdout and stderr into a single output
      logger.prefix(false).info(output.stdout);
      if (output.stderr) {
        logger.prefix(false).error(output.stderr);
      }
      const m5 = `End of output\n${m2}`;
      const msg2 = boxen(error ? chalk.red(m5) : chalk.green(m5), {
        padding: { top: 0, right: 2, left: 2, bottom: 0 },
      });

      msg2.split("\n").forEach((l) => logger.prefix(false).info(l));
    }
  }

  async runScriptsInParallel(packagesToRun) {
    const errors = [];
    const results = [];

    const queueTasks = packagesToRun.map((pkg) => {
      // cannot run the script here, must return a function that will run the script
      // else we start running script for all packages at once
      return async () => {
        // TODO: expose continueOnError option
        if (!this._options.continueOnError && errors.length > 0) {
          return;
        }

        this._logQueueMsg(pkg);

        const runData: any = {
          pkg,
          timer: utils.timer(),
        };

        try {
          runData.output = await this.getRunner()(pkg);
          results.push(runData.output);
        } catch (err: any) {
          err.pkg = pkg;
          errors.push(err);
          results.push(err);
          runData.error = err;
          runData.output = err;
        } finally {
          this._logRunResult(runData);
        }
      };
    });

    const queue = new PQueue({ concurrency: this._concurrency });

    queue.addAll(queueTasks);
    await queue.onIdle();
    return results;
  }

  runScriptsInTopological(packagesToRun) {
    // TODO: what does topo run mean?
    return this.runScriptsInParallel(packagesToRun);
  }

  async exec() {
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

    try {
      let results: ({ failed: boolean; exitCode: number } & Error)[];
      if (this._options.parallel) {
        results = await this.runScriptsInParallel(packagesToRun);
      } else if (this._options.sort) {
        results = await this.runScriptsInTopological(packagesToRun);
      } else {
        results = await this.runScriptsInLexical(packagesToRun);
      }

      if (Array.isArray(results) && results.some((result) => result.failed)) {
        logger.error(chalk.red(`ERROR: failure occurred while running script in these packages`));
        const failures = results.filter((result) => result.failed);
        failures.forEach((result) => {
          const name = _.get(result, "pkg.name");
          logger.error(chalk.red(`  - ${name} - exitCode ${result.exitCode}`));
        });
        // propagate "highest" error code, it's probably the most useful
        const codes = failures.map((error) => error.exitCode);
        const exitCode = Math.max(...codes, 1);
        process.exitCode = exitCode;
      } else {
        const duration = (timer() / 1000).toFixed(1);
        const messages = packagesToRun.map((pkg: any) => ` - ${pkg.name}`);
        logger.info(
          `Finished run npm script '${this._script}' in ${count} ${pkgMsg} in ${duration}s:
${messages.join("\n")}
`
        );
      }
    } catch (err) {
      logger.error(`ERROR - caught exception running scripts`, err);
      process.exit(1);
    }
  }
}
