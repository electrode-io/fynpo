import xsh from "xsh";
import Promise from "bluebird";
import logger from "./logger";
import * as utils from "./utils";

export default class Run {
  _cwd;
  _script;
  _packages;

  constructor(opts, args, packages = {}) {
    this._script = args.script;
    const { dir } = utils.loadConfig(this._cwd);
    this._cwd = dir || opts.cwd;
    this._packages = packages;
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

  exec() {
    if (!this._script) {
      logger.error("You must specify a lifecycle script to run!");
      process.exit(1);
    }
    const packagesToRun = Object.values(this._packages).filter(
      (pkg: any) => pkg.pkgJson && pkg.pkgJson.scripts && pkg.pkgJson.scripts[this._script]
    );

    if (!packagesToRun.length) {
      logger.error(`No packages found with script ${this._script}`);
      process.exit(1);
    }

    return Promise.map(
      packagesToRun,
      (pkg) => {
        logger.info(`===== Running ${this._script} script for package ${pkg.name} =====`);
        return this._sh(`npm run ${this._script}`, pkg.path, false);
      },
      { concurrency: 1 }
    ).then(() => {
      logger.info(`Successfully ran ${this._script} script in all packages`);
      return;
    });
  }
}
