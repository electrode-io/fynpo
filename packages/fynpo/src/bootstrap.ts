/* eslint-disable no-magic-numbers, consistent-return, complexity */

import Promise from "bluebird";
import _ from "lodash";
import ItemQueue, { ItemQueueResult } from "item-queue";
import VisualExec from "visual-exec";
import logger from "./logger";
import chalk from "chalk";
import { isCI } from "./is-ci";

import { locateGlobalFyn } from "./utils";
import { startMetaMemoizer } from "./meta-memoizer";
import { FynpoDepGraph, PackageDepData, pkgInfoId } from "@fynpo/base";

type PackageInstallInfo = {
  depData: PackageDepData;
  status?: string;
};

class Bootstrap {
  _opts;
  _errors: ItemQueueResult<PackageInstallInfo>[];
  _fyn;
  graph: FynpoDepGraph;
  installInfo: Record<string, PackageInstallInfo>;

  constructor(graph: FynpoDepGraph, opts) {
    this._opts = opts;
    this.graph = graph;
    const topo = graph.getTopoSortPackages();
    this.installInfo = {};
    for (const depData of topo.sorted) {
      this.installInfo[depData.pkgInfo.path] = {
        depData,
        status: "",
      };
    }

    this._errors = [];

    this._fyn = null;
  }

  get cwd() {
    return this._opts.cwd;
  }

  get failed() {
    return this._errors.length > 0 ? 1 : 0;
  }

  logErrors() {
    _.each(this._errors, (data: ItemQueueResult<PackageInstallInfo>) => {
      const pkgInfo = data.item?.depData?.pkgInfo;
      const name = pkgInfo?.name;
      const path = pkgInfo?.path;
      const error: any = data.error;
      const output: any = error.output;

      logger.error(`=== Error: fynpo failed bootstrapping ${name} at ${path}`);
      if (isCI) {
        logger.error(`=== CI detected, dumping the debug logs ===`);

        const lines = output.stdout.split("\n");
        if (lines.length > 100) {
          logger.error(`=== dumping last 50 lines of stdout in case the whole thing get truncated by CI ===
${lines.slice(lines.length - 50, lines.length).join("\n")}
`);
        }

        const errLines = output.stderr.split("\n");
        if (errLines.length > 100) {
          logger.error(`=== dumping last 50 lines of stderr in case the whole thing get truncated by CI ===
${errLines.slice(errLines.length - 50, errLines.length).join("\n")}
`);
        }

        logger.error(`=== bootstrap ${name} failure dump of stdout for CI: ===

${output.stdout}
`);

        logger.error(`=== bootstrap ${name} failure dump of stderr for CI: ===

${output.stderr}
`);
      } else {
        // use debug to dump them into logger so they will show up in fynpo-debug.log file
        logger.debug(`=== bootstrap ${name} failure dump of stdout: ===

${output.stdout}
`);

        logger.debug(`=== bootstrap ${name} failure dump of stderr: ===

${output.stderr}
`);
      }
      logger.error(`=== bootstrap ${name} error message:`, error?.message);
      logger.error(`=== END of error info for bootstrapping ${name} at ${path} ===`);
    });
  }

  install(installInfo: PackageInstallInfo, queue: PackageInstallInfo[], nesting = false) {
    const { pkgInfo } = installInfo.depData;
    const pkgRefs = [pkgInfo.name, pkgInfo.path, pkgInfoId(pkgInfo)];

    if (!_.isEmpty(this._opts.ignore) && pkgRefs.find((r) => this._opts.ignore.includes(r))) {
      return true;
    }

    if (
      !nesting &&
      !_.isEmpty(this._opts.only) &&
      !pkgRefs.find((r) => this._opts.only.includes(r))
    ) {
      return true;
    }

    if (installInfo.status === "pending") {
      return false;
    }

    if (installInfo.status === "done") {
      return true;
    }

    let pending = 0;
    for (const path in installInfo.depData.localDepsByPath) {
      if (!this.install(this.installInfo[path], queue, true)) {
        pending++;
        break;
      }
    }

    if (pending === 0 && !installInfo.status) {
      queue.push(installInfo);
      installInfo.status = "pending";
    }

    return false;
  }

  getMoreInstall() {
    const queue: PackageInstallInfo[] = [];

    _.each(this.installInfo, (info: PackageInstallInfo) => {
      this.install(info, queue);
    });

    return queue;
  }

  async exec({ build = true, fynOpts = [], concurrency = 3, skip = [] }) {
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
        }
      }

      logger.info(`Executing fyn with '${process.argv[0]} ${this._fyn}'`);
    }

    let mmOpt = "";

    try {
      const metaMemoizer = await startMetaMemoizer();
      mmOpt = `--meta-mem=http://localhost:${metaMemoizer.info.port}`;
    } catch (err) {
      //
    }

    let logLevelOpts = "";
    if (fynOpts.indexOf("-q") < 0 && fynOpts.indexOf("--log-level") < 0) {
      logLevelOpts = "-q d";
    }

    const fynOptArgs = [process.env.CI ? "--pg simple" : ""]
      .concat(fynOpts, logLevelOpts, `install`, `--sl`, `--no-build-local`, mmOpt)
      .filter((x) => x);

    const dispCmd = chalk.cyan([`fyn`].concat(fynOptArgs).join(" "));
    logger.info(`bootstrap command: ${dispCmd}`);

    const start = Date.now();
    const itemQ = new ItemQueue({
      Promise,
      concurrency,
      stopOnError: true,
      processItem: (item: PackageInstallInfo) => {
        const pkgInfo = item.depData.pkgInfo;
        const name = pkgInfo.name;
        const colorId = chalk.magenta(pkgInfoId(pkgInfo));
        if (skip && skip.includes(name)) {
          logger.info("bootstrap skipping", colorId);
          return;
        }
        const colorPath = chalk.blue(pkgInfo.path);

        const command = [process.argv[0], this._fyn].concat(fynOptArgs).join(" ");
        const colorFyn = chalk.cyan(`fyn`);
        logger[isCI ? "info" : "debug"]("bootstrap", colorId, colorPath);
        const ve = new VisualExec({
          displayTitle: `bootstrap ${colorId} in ${colorPath} ${colorFyn}`,
          cwd: pkgInfo.path,
          command,
          visualLogger: logger,
        });

        // eslint-disable-next-line
        ve.logFinalOutput = function (err, output) {};
        return ve.execute();
      },
      handlers: {
        doneItem: (data: any) => {
          const item: PackageInstallInfo = data.item;
          if (item) {
            item.status = "done";
          }
          const items = this.getMoreInstall();
          itemQ.addItems(items, true);
        },
        done: () => {
          const ts = (Date.now() - start) / 1000;
          logger.info(`bootstrap completed in ${ts}secs`);
          // return this.restorePkgJson();
        },
        failItem: (data) => {
          this._errors.push(data);
          // this.restorePkgJson();
        },
      },
    });

    return itemQ.addItems(this.getMoreInstall()).wait();
  }
}

export = Bootstrap;
