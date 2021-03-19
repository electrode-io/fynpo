/* eslint-disable consistent-return */

import xsh from "xsh";
import fs from "fs-extra";
import Path from "path";
import logger from "./logger";
import * as utils from "./utils";
import _ from "lodash";

export default class Init {
  _cwd;
  _exact;
  _config;

  constructor({ cwd, exact }) {
    this._cwd = cwd;
    this._exact = exact;

    const { config, dir } = utils._searchForFynpo(this._cwd);
    this._cwd = (config && dir) || cwd;
    this._config = config || {};
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

  isGitInitialized = () => {
    return this._sh(`git rev-parse --git-dir`)
      .then(() => true)
      .catch(() => false);
  };

  getFynpoVersion = () => {
    return utils.getGlobalFynpo().then((globalFynpo) => {
      return globalFynpo.version;
    });
  };

  updatePackageJson = (fynpoVersion) => {
    let rootPkg;
    try {
      rootPkg = JSON.parse(fs.readFileSync(Path.join(this._cwd, "package.json")).toString());
      logger.info("updating package.json at", this._cwd);
    } catch {
      logger.info("creating package.json at", this._cwd);
      rootPkg = { name: "root", private: true };
    }

    let target;
    const fynpoDep = _.get(rootPkg, "dependencies.fynpo");
    if (fynpoDep) {
      target = rootPkg.dependencies;
    } else {
      rootPkg.devDependencies ??= {};
      target = rootPkg.devDependencies;
    }

    target.fynpo = this._exact ? fynpoVersion : `^${fynpoVersion}`;
    return fs.writeFile(
      Path.join(this._cwd, "package.json"),
      `${JSON.stringify(rootPkg, null, 2)}\n`
    );
  };

  addFynpoConfig = () => {
    const defaultConfig = {
      changeLogMarkers: ["## Packages", "## Commits"],
      command: {
        publish: {
          tags: {},
          versionTagging: {},
        },
      },
    };

    if (_.isEmpty(this._config)) {
      logger.info("creating fynpo.json at", this._cwd);
    } else {
      logger.info("updating fynpo.json at", this._cwd);
    }

    const finalConfig = Object.assign({}, defaultConfig, this._config);

    return fs.writeFile(
      Path.join(this._cwd, "fynpo.json"),
      `${JSON.stringify(finalConfig, null, 2)}\n`
    );
  };

  addPackagesDirs = () => {
    logger.info("Creating packages directory");
    const pkgDir = Path.resolve(this._cwd, "packages");
    return fs.mkdirp(pkgDir);
  };

  exec() {
    return this.isGitInitialized()
      .then((isGit) => {
        if (!isGit) {
          logger.info("Initializing Git repository");
          return this._sh("git init");
        }
      })
      .then(this.getFynpoVersion)
      .then(this.updatePackageJson)
      .then(this.addFynpoConfig)
      .then(this.addPackagesDirs)
      .then(() => {
        console.log("Successfully initialized fynpo repo");
      });
  }
}
