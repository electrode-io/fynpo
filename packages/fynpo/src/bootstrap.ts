/* eslint-disable no-magic-numbers, consistent-return, complexity */

import _ from "lodash";
import { ItemQueueResult } from "item-queue";
import { logger } from "./logger";
import chalk from "chalk";
import { isCI } from "./is-ci";
import {
  FynpoDepGraph,
  FynpoPackageInfo,
  FynpoTopoPackages,
  PackageDepData,
  pkgInfoId,
} from "@fynpo/base";

import { TopoRunner } from "./topo-runner";
import { PkgBuildCache } from "./caching";
import * as xaa from "xaa";
import { InstallDeps } from "./install-deps";
import { checkGlobalFynVersion } from "./utils";

type PackageInstallInfo = {
  depData: PackageDepData;
  status?: string;
};

export class Bootstrap {
  _opts;
  graph: FynpoDepGraph;
  topoPkgs: FynpoTopoPackages;
  installInfo: Record<string, PackageInstallInfo>;
  _topoRunner: TopoRunner;

  constructor(graph: FynpoDepGraph, opts) {
    this._opts = opts;
    this.topoPkgs = graph.getTopoSortPackages();
    this._topoRunner = new TopoRunner(this.topoPkgs, opts);
    this.graph = graph;
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
    const installDeps = new InstallDeps(this.cwd, fynOpts);
    await checkGlobalFynVersion();

    const dispCmd = chalk.cyan([`fyn`].concat(installDeps.fynOptArgs).join(" "));
    logger.info(`bootstrap command: ${dispCmd}`);
    const colorFyn = chalk.cyan(`fyn`);

    await this._topoRunner.start({
      concurrency,
      processor: async (pkgInfo: FynpoPackageInfo, depData: PackageDepData) => {
        const colorId = chalk.magenta(pkgInfoId(pkgInfo));
        if (skip && skip.includes(pkgInfo.name)) {
          logger.info("bootstrap skipping", colorId);
          return;
        }
        const colorPath = chalk.blue(pkgInfo.path);

        const cacheRules = _.get(this._opts, "packageCache.default");
        let cached: PkgBuildCache;
        if (!_.isEmpty(cacheRules)) {
          cached = new PkgBuildCache(this.cwd, this._opts, cacheRules, "bootstrap");
          await cached.checkCache(depData);
        }

        if (cached && cached.exist) {
          if (cached.exist === "remote") {
            await cached.downloadCacheFromRemote();
          }
          await cached.restoreFromCache();
          logger.info("Done bootstrap", colorId, colorPath, chalk.cyan(`(${cached.exist} cached)`));
        } else {
          logger[isCI ? "info" : "debug"]("bootstrap", colorId, colorPath);
          const displayTitle = `bootstrap ${colorId} in ${colorPath} ${colorFyn}`;
          await installDeps.runVisualInstall(pkgInfo, displayTitle);
          if (cached && cached.enable) {
            await xaa.try(() => cached.copyToCache());
          }
        }
      },
      stopOnError: true,
    });
  }
}
