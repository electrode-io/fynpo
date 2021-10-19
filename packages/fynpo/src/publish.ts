/* eslint-disable consistent-return */

import xsh from "xsh";
import Path from "path";
import Promise from "bluebird";
import logger from "./logger";
import * as utils from "./utils";
import * as _ from "lodash";

export default class Publish {
  _cwd;
  _distTag;
  _dryRun;
  _push;
  _packageInfo;
  _packagesToPublish;
  _rootScripts;
  _fynpoRc;
  _messages;
  _tagTmpl: string;
  constructor({ cwd, distTag, dryRun, push }, pkgInfo = {}) {
    this._distTag = distTag;
    this._dryRun = dryRun;
    this._push = push;
    this._packageInfo = pkgInfo;

    const { fynpoRc, dir } = utils.loadConfig(this._cwd);
    this._cwd = dir || cwd;
    this._fynpoRc = fynpoRc || {};

    this._rootScripts = utils.getRootScripts(this._cwd);

    const gitTagTmpl = _.get(
      this._fynpoRc,
      "command.publish.gitTagTemplate",
      utils.defaultTagTemplate
    );

    this._tagTmpl = gitTagTmpl;
  }

  _sh(command, cwd = this._cwd, silent = false) {
    logger.info(`Executing shell command '${command}' in ${cwd}`);
    return xsh.exec(
      {
        silent,
        cwd,
        env: Object.assign({}, process.env, { PWD: cwd }),
      },
      command
    );
  }

  _logError(msg, err, showOutput = false) {
    logger.error(msg, err.stack);
    if (showOutput) {
      const stdout = _.get(err, "output.stdout", "");
      const stderr = _.get(err, "output.stderr", "");
      stdout && logger.error(stdout);
      stderr && logger.error(stderr);
    }
  }

  getLatestTag() {
    const tagSearch = utils.makePublishTagSearchTerm(this._tagTmpl);
    return this._sh(`git tag --points-at HEAD --list ${tagSearch}`).then((output) => {
      const tagInfo = output.stdout.split("\n").filter((x) => x.trim().length > 0);
      if (tagInfo.length > 0) {
        logger.error(
          "Error: HEAD commit already has a release tag. Assuming no packages changed since last release. Skipping publish!"
        );
        process.exit(1);
      }
      return;
    });
  }

  runLifeCycleScripts(scripts = []) {
    return Promise.map(
      scripts,
      (name) => {
        if (this._rootScripts[name]) {
          return this._sh(this._rootScripts[name]);
        }
      },
      { concurrency: 1 }
    ).then(() => {
      logger.info(`Successfully ran scripts ${scripts.join(",")} in root.`);
    });
  }

  getPackagesToPublish() {
    return Promise.all([
      // this will output file paths with / as separator, even on windows
      // note: it may actually depend on git configuration
      this._sh(`git diff-tree --no-commit-id --name-only -r HEAD`),
      // get the commit message
      this._sh(`git log -1 --pretty=%B`),
    ]).then(([changedFiles, commitMsg]) => {
      if (!commitMsg.stdout.includes("[Publish]")) {
        return [];
      }

      const packageNames = commitMsg.stdout
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x.length > 0 && x.startsWith(`- `))
        .map((x) => {
          const ix2 = x.lastIndexOf("@");
          return x.substring(2, ix2);
        });

      const packagePaths = changedFiles.stdout
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => Path.basename(x) === "package.json")
        .map((x) => Path.dirname(x));

      return Object.values(this._packageInfo.packages).filter((pkg: any) => {
        return (
          packagePaths.includes(pkg.path) && !pkg.pkgJson.private && packageNames.includes(pkg.name)
        );
      });
    });
  }

  publishPackages() {
    const dryRunCmd = this._dryRun ? " --dry-run" : "";
    const distTagCmd = this._distTag ? ` --tag ${this._distTag}` : "";

    return Promise.map(
      this._packagesToPublish,
      (pkg) => {
        const publishCmd = `npm publish${distTagCmd}${dryRunCmd}`;
        logger.info(`===== Running publish for package ${pkg.name} with '${publishCmd}' =====`);
        logger.info(`===== package dir: ${pkg.path} =====`);

        return this._sh(publishCmd, Path.resolve(this._cwd, pkg.path)).then((_output) => {
          logger.info(`===== Published package ${pkg.name}@${pkg.version} =====`);
          logger.info("-------------------------------------------------");
        });
      },
      { concurrency: 1 }
    )
      .then(() => {
        logger.info(`Successfully published:\n${this._messages.join("\n")}`);
      })
      .catch((err) => {
        this._logError("Publish failed:", err);
        process.exit(1);
      });
  }

  async addReleaseTag() {
    if (this._dryRun) {
      return;
    }

    logger.info(`===== Adding Release Tag =====`);

    try {
      let commitIds = [];

      if (this._tagTmpl.includes("{COMMIT}")) {
        const commitOutput = await this._sh(`git log --format="%h" -n 1`);
        commitIds = commitOutput.stdout.split("\n").filter((x) => x.trim().length > 0);
      }

      const newTag = utils.makePublishTag(this._tagTmpl, {
        date: new Date(),
        gitHash: commitIds[0] || "",
      });

      const tagOut = await this._sh(`git tag -a ${newTag} -m "Release Tag"`);
      logger.info("tag", newTag, "output", tagOut);
      if (this._dryRun || !this._push) {
        logger.info(`Release tag ${newTag} created!`);
        return;
      }

      logger.info(`Release tag ${newTag} created. Pushing the tag to remote..`);

      // await this._sh(`git push origin ${newTag}`, this._cwd, false);
    } catch (err) {
      this._logError("Creating release tag failed", err);
      process.exit(1);
    }
  }

  exec() {
    return this.getLatestTag()
      .then(() => this.getPackagesToPublish())
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
      .then(() => {
        return this.addReleaseTag();
      });
  }
}
