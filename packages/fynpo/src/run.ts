/* reuses some of the awesome work from https://github.com/lerna/lerna/blob/main/commands/run/index.js */
/* eslint-disable consistent-return */

import xsh from "xsh";
import logger from "./logger";
import * as utils from "./utils";
import _ from "lodash";
import { npmRunScriptStreaming, npmRunScript } from "./npm-run-script";
import boxen from "boxen";
import chalk from "chalk";
import { FynpoDepGraph, FynpoTopoPackages, PackageDepData, FynpoPackageInfo } from "@fynpo/base";
import ItemQueue from "item-queue";
import { TopoRunner } from "./topo-runner";

type RunResult = { failed: boolean; exitCode: number } & Error;

export default class Run {
  _cwd;
  _script;
  _options;
  _args;
  _npmClient;
  graph: FynpoDepGraph;
  _concurrency: number;
  private topo: FynpoTopoPackages;

  constructor(opts, args, graph: FynpoDepGraph) {
    this._script = args.script;
    this._cwd = opts.dir || opts.cwd;
    this._options = opts;
    this._args = this._options["--"] || [];
    this._npmClient = "npm";
    // enforce concurrency to be an integer between 1 and 100, else default to 3
    this._concurrency =
      Number.isInteger(opts.concurrency) && opts.concurrency >= 1 && opts.concurrency <= 100
        ? opts.concurrency
        : 3;
    this.topo = graph.getTopoSortPackages();
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
    return this.runScriptsInParallel(packagesToRun);
  }

  _logQueueMsg(pkg) {
    const name = pkg.name;
    const msg = boxen(
      `Queueing package ${name} to run script '${this._script}'
path: ${pkg.path}`,
      {
        padding: { top: 0, right: 2, left: 2, bottom: 0 },
      }
    );

    msg.split("\n").forEach((l) => logger.prefix(false).info(l));
  }

  _logRunResult({ timer, error, output, pkg }) {
    const name = pkg.name;

    const duration = (timer() / 1000).toFixed(1);
    const m1 = error ? "ERROR - Failed" : "Completed";
    const m2 = `${m1} run script '${this._script}' for package ${name}.  Time: ${duration}s
path: ${pkg.path}`;
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

  async runPackage(pkgInfo: FynpoPackageInfo, results: RunResult[], errors: Error[]) {
    // TODO: expose continueOnError option
    if (!this._options.continueOnError && errors.length > 0) {
      return;
    }

    this._logQueueMsg(pkgInfo);

    const runData: any = {
      pkg: pkgInfo,
      timer: utils.timer(),
    };

    try {
      runData.output = await this.getRunner()(pkgInfo);
      results.push(runData.output);
    } catch (err: any) {
      err.pkg = pkgInfo;
      errors.push(err);
      results.push(err);
      runData.error = err;
      runData.output = err;
    } finally {
      this._logRunResult(runData);
    }
  }

  async runScriptsInParallel(packagesToRun: PackageDepData[]) {
    const errors: Error[] = [];
    const results: RunResult[] = [];

    const queue = new ItemQueue<FynpoPackageInfo>({
      processItem: async (pkgInfo) => {
        return this.runPackage(pkgInfo, results, errors);
      },
      itemQ: packagesToRun.map((d) => d.pkgInfo),
      concurrency: this._concurrency,
    });

    await queue.start().wait();

    return results;
  }

  async runScriptsInTopological(packagesToRun: PackageDepData[]) {
    const errors: Error[] = [];
    const results: RunResult[] = [];

    const topoRunner = new TopoRunner({ ...this.topo, sorted: packagesToRun }, this._options);

    await topoRunner.start({
      concurrency: this._concurrency,
      processor: (pkgInfo: FynpoPackageInfo) => {
        return this.runPackage(pkgInfo, results, errors);
      },
    });

    return results;
  }

  async exec() {
    if (!this._script) {
      logger.error("You must specify a lifecycle script to run!");
      process.exit(1);
    }

    const packagesToRun = this.topo.sorted.filter((depData: PackageDepData) => {
      const pkgInfo = depData.pkgInfo;
      const scriptToRun = _.get(pkgInfo, ["pkgJson", "scripts", this._script]);
      return scriptToRun;
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
      let results: RunResult[];

      if (this._options.parallel) {
        logger.info(`executing script in packages in parallel - concurrency ${this._concurrency}`);
        results = await this.runScriptsInParallel(packagesToRun);
      } else if (this._options.sort) {
        logger.info(
          `executing script in packages in topo sort order - concurrency ${this._concurrency}`
        );
        results = await this.runScriptsInTopological(packagesToRun);
      } else {
        logger.info(
          `executing script in packages in lexical order - concurrency ${this._concurrency}`
        );
        results = await this.runScriptsInLexical(packagesToRun);
      }

      if (Array.isArray(results) && results.some((result) => result.failed)) {
        logger.error(chalk.red(`ERROR: failure occurred while running script in these packages`));
        const failures = results.filter((result) => result.failed);
        failures.forEach((result) => {
          const name = _.get(result, "pkg.name");
          logger.error(chalk.red(`  - ${name} - exit code ${result.exitCode}`));
        });
        // propagate "highest" error code, it's probably the most useful
        const codes = failures.map((error) => error.exitCode);
        const exitCode = Math.max(...codes, 1);
        process.exitCode = exitCode;
      } else {
        const duration = (timer() / 1000).toFixed(1);
        const messages = packagesToRun.map((d) => ` - ${d.pkgInfo.name}`);
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
