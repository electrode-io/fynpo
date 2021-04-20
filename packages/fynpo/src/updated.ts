/* reuses some of the logics from https://github.com/lerna/lerna/blob/main/commands/changed/index.js */
import * as utils from "./utils";
import logger from "./logger";
import { execSync } from "./child-process";
import getUpdatedPackages from "./utils/get-updated-packages";
import _ from "lodash";
import path from "path";
import slash from "slash";
import minimatch from "minimatch";

export default class Updated {
  _cwd;
  _options;
  name;
  _packages;
  _versionLockMap;
  _lockAll;

  constructor(opts, data) {
    this.name = "updated";
    const { dir, fynpoRc } = utils.loadConfig(this._cwd);
    this._cwd = dir || opts.cwd;
    this._packages = data.packages;

    this._versionLockMap = {};
    const versionLocks = _.get(fynpoRc, "versionLocks", []);
    if (versionLocks[0] && versionLocks[0] === "*") {
      this._lockAll = true;
    } else {
      versionLocks.reduce((mapping, locks) => {
        locks.forEach((name) => (mapping[name] = locks));
        return mapping;
      }, this._versionLockMap);
    }

    const commandConfig = (fynpoRc as any).command || {};
    const overrides = commandConfig[this.name];
    this._options = _.defaults(opts, overrides, fynpoRc);
  }

  exec() {
    const opts = Object.assign({}, this._options, {
      cwd: this._cwd,
      lockAll: this._lockAll,
      versionLockMap: this._versionLockMap,
    });

    const { pkgs: updates } = getUpdatedPackages({ packages: this._packages }, opts);

    if (!updates.length) {
      logger.info(`No changed packages!`);
      return;
    }

    const messages = updates.map((name) => ` - ${name}`);
    logger.info(`Changed packages: \n${messages.join("\n")}`);
  }
}
