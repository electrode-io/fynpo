/* eslint-disable no-magic-numbers, consistent-return, complexity */

import Path from "path";
import _ from "lodash";
import { ItemQueueResult } from "item-queue";
import VisualExec from "visual-exec";
import logger from "./logger";
import chalk from "chalk";
import { isCI } from "./is-ci";

import { locateGlobalFyn } from "./utils";
import { startMetaMemoizer } from "./meta-memoizer";
import { FynpoDepGraph, PackageDepData, pkgInfoId } from "@fynpo/base";

import { TopoRunner } from "./topo-runner";
import os from "os";

type PackageInstallInfo = {
  depData: PackageDepData;
  status?: string;
};

class Bootstrap {
  _opts;
  _fyn;
  graph: FynpoDepGraph;
  installInfo: Record<string, PackageInstallInfo>;
  _topoRunner: TopoRunner;

  constructor(graph: FynpoDepGraph, opts) {
    this._opts = opts;
    this._topoRunner = new TopoRunner(graph.getTopoSortPackages(), opts);
    this._fyn = null;
  }

  get cwd() {
    return this._opts.cwd;
  }

  get failed() {
    return this._topoRunner._errors.length > 0 ? 1 : 0;
  }

  get elapsedTime() {
    return this._topoRunner._totalTime;
  }

  logErrors() {
    _.each(this._topoRunner._errors, (data: ItemQueueResult<PackageInstallInfo>) => {
      const pkgInfo = data.item?.depData?.pkgInfo;
      const name = pkgInfo?.name;
      const path = pkgInfo?.path;
      const error: any = data.error;
      const output: any = error.output;

      logger.error(`=== Error: fynpo failed bootstrapping ${name} at ${path}`);

      if (!output) {
        logger.error(error);
        return;
      }

      if (isCI && output) {
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

  async exec({
    build = true, // eslint-disable-line
    fynOpts = [],
    concurrency = 6,
    skip = [],
  }) {
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

      const nodeDir = process.argv[0].replace(os.homedir(), "~");
      const fynDir = `.${Path.sep}${Path.relative(process.cwd(), this._fyn)}`;

      logger.info(`Executing fyn with '${nodeDir} ${fynDir}'`);
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
    await this._topoRunner.start({
      concurrency,
      processor: (pkgInfo) => {
        const colorId = chalk.magenta(pkgInfoId(pkgInfo));
        if (skip && skip.includes(pkgInfo.name)) {
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

        ve.logFinalOutput = _.noop;
        return ve.execute();
      },
      stopOnError: true,
    });
  }
}

export = Bootstrap;
