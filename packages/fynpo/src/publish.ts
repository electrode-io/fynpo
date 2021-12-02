import xsh from "xsh";
import Path from "path";
import Promise from "bluebird";
import { logger } from "./logger";
import * as utils from "./utils";
import * as _ from "lodash";
import fyn from "fyn/bin";
import shcmd from "shcmd";
import { FynpoDepGraph, FynpoPackageInfo } from "@fynpo/base";
import { TopoRunner } from "./topo-runner";

/**
 * `fynpo publish` command executor class
 *
 */
export default class Publish {
  _cwd: string;
  _distTag: string;
  _dryRun: boolean;
  _push: boolean;
  _packagesToPublish: FynpoPackageInfo[];
  _fynpoRc: any;
  _tagTmpl: string;
  _graph: FynpoDepGraph;
  _tgzFiles: string[];

  constructor(opts, graph: FynpoDepGraph) {
    this._cwd = opts.cwd;
    this._fynpoRc = opts;
    this._graph = graph;
    this._dryRun = opts.dryRun;
    this._distTag = opts.distTag;
    this._push = opts.push;

    const gitTagTmpl = _.get(
      this._fynpoRc,
      "command.publish.gitTagTemplate",
      utils.defaultTagTemplate
    );

    this._tagTmpl = gitTagTmpl;
    this._tgzFiles = [];
  }

  _sh(command: string, cwd = this._cwd, silent = false) {
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

  _logError(msg: string, err: Error, showOutput = false) {
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

  async getPackagesToPublish() {
    const [changedFiles, commitMsg] = await Promise.all([
      // this will output file paths with / as separator, even on windows
      // note: it may actually depend on git configuration
      this._sh(`git diff-tree --no-commit-id --name-only -r HEAD`),
      // get the commit message
      this._sh(`git log -1 --pretty=%B`),
    ]);

    if (!commitMsg.stdout.includes("[Publish]")) {
      logger.info(`Head git commit message doesn't have '[Publish]' - skip publish`);
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

    return Object.values(this._graph.packages.byId).filter((pkg: FynpoPackageInfo) => {
      return (
        packagePaths.includes(pkg.path) && !pkg.pkgJson.private && packageNames.includes(pkg.name)
      );
    });
  }

  async runScript(pkg: FynpoPackageInfo, script: string) {
    if (_.get(pkg.pkgJson, ["scripts", script])) {
      const pkgFullDir = Path.join(this._fynpoRc.cwd, pkg.path);
      shcmd.pushd(pkgFullDir);
      try {
        await fyn.run(["run", script, "--cwd", pkgFullDir], 0, false);
      } finally {
        shcmd.popd();
      }
    }
  }

  _cleanupFile(name: string) {
    try {
      shcmd.rm(name);
    } catch (_err) {
      //
    }
  }

  async publishPackages() {
    const toPublishPaths = this._packagesToPublish.map((x) => x.path);
    const topoRunner = new TopoRunner(this._graph.getTopoSortPackages(), this._fynpoRc);

    await topoRunner.start({
      concurrency: 1,
      processor: async (pkgInfo) => {
        if (toPublishPaths.includes(pkgInfo.path)) {
          logger.info(`Publishing ${pkgInfo.name} at path ${pkgInfo.path}`);

          const pkgFullDir = Path.join(this._fynpoRc.cwd, pkgInfo.path);

          shcmd.pushd(pkgFullDir);

          try {
            await this.runScript(pkgInfo, "prepublishOnly");
            const pack = this._sh("npm pack", pkgFullDir);
            await pack.promise;
            await this.runScript(pkgInfo, "publish");
            await this.runScript(pkgInfo, "postpublish");
          } finally {
            shcmd.popd();
          }

          const outName = pkgInfo.name.replace(/\//g, "-").replace(/@/g, "");
          const tgzName = `${outName}-${pkgInfo.version}.tgz`;
          logger.info(`Prepared ${tgzName} for publishing`);
          this._tgzFiles.push(Path.join(pkgFullDir, tgzName));
        }
      },
    });

    const errors: Error[] = [];

    if (!this._dryRun) {
      logger.info(`Publishing these tgz files with npm`, this._tgzFiles);
      for (const tgzFile of this._tgzFiles) {
        const tag = this._distTag ? ` --tag ${this._distTag}` : "";
        const cmd = `npm publish${tag} ${tgzFile}`;
        logger.info(`===== publishing ${tgzFile} with command '${cmd}'`);
        const sh = this._sh(cmd, Path.dirname(tgzFile));
        try {
          await sh.promise;
          logger.info(`===== Successfully published ${tgzFile} =====`);
          this._cleanupFile(tgzFile);
        } catch (err) {
          delete err.output;
          logger.error(`==== failed to publish '${tgzFile}' ====`, err);
          errors.push(err);
        }
      }
    } else {
      logger.info(`Dry-run true, not doing actual npm publish, tgz files:`, this._tgzFiles);
    }

    return errors;
  }

  async addReleaseTag() {
    logger.info(`===== Adding Release Tag =====`);

    let newTag: string;

    try {
      const dryRun = this._dryRun ? `echo DRY RUN ` : "";
      let commitIds = [];

      if (this._tagTmpl.includes("{COMMIT}")) {
        const commitOutput = await this._sh(`git log --format="%h" -n 1`);
        commitIds = commitOutput.stdout.split("\n").filter((x) => x.trim().length > 0);
      }

      newTag = utils.makePublishTag(this._tagTmpl, {
        date: new Date(),
        gitHash: commitIds[0] || "",
      });

      await this._sh(`${dryRun}git tag -a ${newTag} -m "Release Tag"`);
      const gitStatus = await this._sh(`git status -b --porcelain=v2`);
      const upstream = gitStatus.stdout.split("\n").find((x) => x.includes(`branch.upstream`));
      const [gitRemote, gitBranch] = upstream.split(" ")[2].split("/");

      if (!gitRemote || !gitBranch) {
        logger.error(
          `Unable to figure out git tracking remote and branch - skip create and push git release tag`
        );
        return;
      }

      if (!this._push) {
        logger.info(
          `Release tag ${newTag} created for branch ${gitBranch}, but not pushing to git remote ${gitRemote}!`
        );
        return;
      }

      logger.info(
        `Release tag ${newTag} created for branch ${gitBranch}. Pushing the tag to remote ${gitRemote}..`
      );

      await this._sh(`${dryRun}git push ${gitRemote} ${newTag}`, this._cwd, false);
    } catch (err) {
      this._logError(`Failed to create release tag ${newTag}`, err);
      process.exit(1);
    }
  }

  async exec() {
    await this.getLatestTag();
    const packagesToPublish = await this.getPackagesToPublish();

    if (!packagesToPublish.length) {
      logger.warn("No changed packages to publish!");
      process.exit(1);
    }

    this._packagesToPublish = packagesToPublish;
    const messages = packagesToPublish.map(
      (pkg: FynpoPackageInfo) => ` - ${pkg.name}@${pkg.version}`
    );

    logger.info(`Found these packages to publish:\n${messages.join("\n")}`);

    try {
      const errors = await this.publishPackages();
      if (errors.length > 0) {
        logger.error(`Some error occurred with publishing - skipping create git release tag`);
      } else {
        await this.addReleaseTag();
      }
    } catch (err) {
      logger.error(`==== failure encountered publishing packages =====`, err);
      process.exit(1);
    }
  }
}
