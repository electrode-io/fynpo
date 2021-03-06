/* eslint-disable consistent-return */

import xsh from "xsh";
import path from "path";
import Promise from "bluebird";
import logger from "./logger";
import * as utils from "./utils";

export default class Publish {
  _cwd;
  _distTag;
  _dryRun;
  _push;
  _packages;
  _packagesToPublish;
  _rootScripts;
  _fynpoRc;
  _messages;
  constructor({ cwd, distTag, dryRun, push }, packages = {}) {
    this._distTag = distTag;
    this._dryRun = dryRun;
    this._push = push;
    this._packages = packages;

    const { fynpoRc, dir } = utils.loadConfig(this._cwd);
    this._cwd = dir || cwd;
    this._fynpoRc = fynpoRc || {};

    this._rootScripts = utils.getRootScripts(this._cwd);
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

  getLatestTag = () => {
    return this._sh(`git tag --points-at HEAD --list fynpo-rel-*`).then((output) => {
      const tagInfo = output.stdout.split("\n").filter((x) => x.trim().length > 0);
      if (tagInfo.length > 0) {
        logger.error(
          "Error: HEAD commit already has a release tag. Assuming no packages changed since last release. Skipping publish!"
        );
        process.exit(1);
      }
      return;
    });
  };

  runLifeCycleScripts = (scripts = []) => {
    return Promise.map(
      scripts,
      (name) => {
        if (this._rootScripts[name]) {
          return this._sh(this._rootScripts[name], this._cwd, false);
        }
      },
      { concurrency: 1 }
    ).then(() => {
      logger.info(`Successfully ran scripts ${scripts.join(",")} in root.`);
    });
  };

  getPackagesToPublish = () => {
    return this._sh(`git diff-tree --no-commit-id --name-only -r HEAD`).then((output) => {
      const packages = output.stdout
        .split("\n")
        .filter((x) => x.trim().length > 0 && path.basename(x) === "package.json");
      const paths = packages.map((p) => path.join(this._cwd, path.dirname(p)));

      return Object.values(this._packages)
        .filter((pkg: any) => paths.includes(pkg.path))
        .filter((pkg: any) => !pkg.pkgJson.private);
    });
  };

  publishPackages = () => {
    const dryRunCmd = this._dryRun ? " --dry-run" : "";
    const distTagCmd = this._distTag ? ` --tag ${this._distTag}` : "";

    return Promise.map(
      this._packagesToPublish,
      (pkg) => {
        logger.info(`===== Running publish for package ${pkg.name} =====`);
        return this._sh("npm pack --dry-run", pkg.path).then((output) => {
          logger.info("List of files npm publish will include:");
          logger.info(output.stderr);

          return this._sh(`npm publish${distTagCmd}${dryRunCmd}`, pkg.path).then(() => {
            logger.info(`Published package ${pkg.name}@${pkg.version}`);
            logger.info("-------------------------------------------------");
          });
        });
      },
      { concurrency: 1 }
    ).then(() => {
      logger.info(`Successfully published:\n${this._messages.join("\n")}`);
      return;
    });
  };

  addReleaseTag = () => {
    logger.info(`===== Adding Release Tag =====`);
    return this._sh(`git log --format="%h" -n 1`).then((output) => {
      const commitIds = output.stdout.split("\n").filter((x) => x.trim().length > 0);
      const newTag = `fynpo-rel-${commitIds[0]}`;

      return this._sh(`git tag -a ${newTag} -m "Release Tag"`).then((tagOut) => {
        logger.info("tag", newTag, "output", tagOut);
        if (this._dryRun || !this._push) {
          logger.info(`Release tag ${newTag} created!`);
          return;
        }

        logger.info(`Release tag ${newTag} created. Pushing the tag to remote..`);
        return this._sh(`git push origin ${newTag}`);
      });
    });
  };

  exec() {
    return this.getLatestTag()
      .then(this.getPackagesToPublish)
      .then((packagesToPublish) => {
        if (!packagesToPublish.length) {
          logger.warn("No changed packages to publish!");
          process.exit(1);
        }

        this._packagesToPublish = packagesToPublish;
        this._messages = packagesToPublish.map((pkg) => ` - ${pkg.name}@${pkg.version}`);

        logger.info(`Found these packages to publish:\n${this._messages.join("\n")}`);
        //return this.runLifeCycleScripts(["prepare", "prepublishOnly"]);
        return this.publishPackages();
      })
      .then(this.addReleaseTag);
  }
}
