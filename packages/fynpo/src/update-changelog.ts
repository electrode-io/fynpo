/*
 * Looks at each commit that is not a "Merge pull request", figure out
 * the packages it modified and group the commit messages by package.
 *
 * Then check for [major], [minor], [patch] in the commit message, and
 * automatically generate the new package tag name with the would be
 * updated version.
 *
 * Write all these to the file CHANGELOG.md.
 *
 */

/* eslint-disable complexity, consistent-return, max-depth */

import Fs from "fs";
import xsh from "xsh";
import Path from "path";
import assert from "assert";
import Promise from "bluebird";
import semver from "semver";
xsh.Promise = Promise;
xsh.envPath.addToFront(Path.join(__dirname, "../node_modules/.bin"));
import _ from "lodash";
import * as utils from "./utils";
import logger from "./logger";

export default class Changelog {
  _cwd;
  _fynpoRc;
  _data;
  _changeLogFile;
  _changeLog;
  _lockAll;
  _versionLockMap;

  constructor({ cwd }, data) {
    this._cwd = cwd;
    const { fynpoRc, dir } = utils.loadConfig(this._cwd);
    this._cwd = dir || cwd;
    this._fynpoRc = fynpoRc || {};
    this._data = data;
    this._versionLockMap = {};

    const versionLocks = _.get(this._fynpoRc, "versionLocks", []);

    if (versionLocks[0] && versionLocks[0] === "*") {
      this._lockAll = true;
    } else {
      versionLocks.reduce((mapping, locks) => {
        locks.forEach((name) => (mapping[name] = locks));
        return mapping;
      }, this._versionLockMap);
    }

    try {
      this._changeLogFile = Path.resolve("CHANGELOG.md");
      this._changeLog = Fs.readFileSync(this._changeLogFile).toString();
    } catch {
      this._changeLogFile = Path.join(this._cwd, "CHANGELOG.md");
      this._changeLog = "";
    }
  }

  _sh(command) {
    return xsh.exec(
      {
        silent: true,
        cwd: this._cwd,
        env: Object.assign({}, process.env, { PWD: this._cwd }),
      },
      command
    );
  }

  checkGitClean = () => {
    return this._sh(`git diff --quiet -- . ':(exclude)CHANGELOG.md'`)
      .then(() => true)
      .catch(() => false);
  };

  checkIfTagExists = () => {
    return this._sh(`git tag --list fynpo-rel-*`).then((output) => {
      const tagInfo = output.stdout.split("\n").filter((x) => x.trim().length > 0);
      if (!tagInfo.length) {
        logger.info("Can't find latest release tag. Assuming all packages changed.");
        return;
      }
      return this.getLatestTag();
    });
  };

  getLatestTag = () => {
    return this._sh(`git describe --abbrev=0 --match fynpo-rel-*`).then((output) => {
      const tagInfo = output.stdout.split("\n").filter((x) => x.trim().length > 0);
      assert(tagInfo[0], "Can't find latest release tag");
      logger.info(`Last release tag: ${tagInfo[0]}`);
      return tagInfo[0];
    });
  };

  listGitCommits = (tag) => {
    const logCmd = tag
      ? `git log ${tag}...HEAD --pretty=format:'%H %s'`
      : `git log --pretty=format:'%H %s'`;

    return this._sh(logCmd)
      .then((output) => {
        const commits = output.stdout
          .split("\n")
          .filter(
            (x) =>
              x.length > 0 && !x.startsWith("Merge pull request #") && !x.includes("[no-changelog]")
          );
        return commits.reduce(
          (a, x) => {
            const idx = x.indexOf(" ");
            const id = x.substr(0, idx);
            a.ids.push(id);
            a[id] = x.substr(idx + 1);
            return a;
          },
          { ids: [] }
        );
      })
      .then((commits) => {
        if (this._changeLog.indexOf(commits.ids[0]) >= 0) {
          logger.error("change log already contain a commit from new commits");
          process.exit(1);
        }
        return commits;
      });
  };

  collateCommitsPackages = (commits) => {
    const commitIds = commits.ids;
    const collated = {
      forcePackages: [],
      realPackages: [],
      packages: {},
      samples: {},
      others: {},
      files: {},
    };

    return Promise.map(
      commitIds,
      (id) => {
        return this._sh(`git diff-tree --no-commit-id --name-only --root -r ${id}`).then(
          (output) => {
            // determine packages changed
            const files = output.stdout.split("\n").filter((x) => x.trim().length > 0);
            const handled = { packages: {}, others: {}, files: {} };
            files.reduce((a, x) => {
              const parts = x.split("/");
              const add = (group, key) => {
                if (handled[group][key]) return;
                a[group][key] ??= {};
                if (!a[group][key].msgs) {
                  a[group][key].msgs = [];
                }
                a[group][key].msgs.push({ m: commits[id], id });
                handled[group][key] = true;
              };

              if (parts[0] === "packages") {
                if (Fs.existsSync(Path.resolve("packages", parts[1]))) {
                  /* eslint-disable @typescript-eslint/no-var-requires */
                  const Pkg = require(Path.resolve("packages", parts[1], "package.json"));
                  if (collated.realPackages.indexOf(Pkg.name) < 0) {
                    collated.realPackages.push(Pkg.name);
                    a.packages[Pkg.name] = { dirName: parts[1] };
                  }
                  add(parts[0], Pkg.name);
                }
              } else if (parts.length > 1) {
                add("others", parts[0]);
              } else {
                add("files", parts[0]);
              }

              return a;
            }, collated);
            return "";
          }
        );
      },
      { concurrency: 1 }
    ).then(() => collated);
  };

  determinePackageVersions = (collated) => {
    const types = ["patch", "minor", "major"];

    const findVersion = (name, updateType) => {
      const Pkg = _.get(this._data.packages, [name, "pkgJson"], {});
      collated.packages[name] = collated.packages[name] || {};

      collated.packages[name].version = Pkg.version;
      const x = semver.parse(Pkg.version);
      collated.packages[name].versionOnly = `${x.major}.${x.minor}.${x.patch}`;
      collated.packages[name].semver = x;
      collated.packages[name].newVersion = semver.inc(
        collated.packages[name].versionOnly,
        types[updateType]
      );
      collated.packages[name].updateType = updateType;
      collated.packages[name].originalPkg = Pkg;
    };

    const findUpdateType = (name, minBumpType = 0) => {
      collated.packages[name] = collated.packages[name] || {};
      const msgs = collated.packages[name].msgs || [];

      const updateType = msgs.reduce((a, x) => {
        if (x.m.indexOf("[maj") >= 0) {
          if (a < 2) {
            a = 2;
          }
        } else if (x.m.indexOf("[min") >= 0) {
          if (a < 1) {
            a = 1;
          }
        }
        return a;
      }, minBumpType);

      collated.packages[name].updateType = updateType;
    };

    // find bump type for packages that have direct changes
    collated.realPackages.forEach((name) => findUpdateType(name));

    // If all packages are version locked, bump all the packages to the highest type
    if (this._lockAll) {
      const updateTypes = collated.realPackages
        .map((name) => collated.packages[name])
        .map((x) => x.updateType);
      const minBumpType = _.max(updateTypes);

      for (const name of Object.keys(this._data.packages)) {
        if (!collated.realPackages.includes(name)) {
          collated.realPackages.push(name);
        }
        findVersion(name, minBumpType);
      }

      const directBumps = collated.realPackages.filter(
        (name) => collated.packages[name] && collated.packages[name].newVersion
      );
      collated.directBumps = directBumps;
      collated.indirectBumps = [];
      return Promise.resolve(collated);
    }

    // check for version locking of direct bump packages
    collated.realPackages.forEach((name) => {
      const verLocks = this._versionLockMap[name];
      if (verLocks) {
        console.log("verLocks", name, verLocks);
        for (const lockPkgName of _.without(verLocks, name)) {
          if (!collated.realPackages.includes(lockPkgName)) {
            collated.realPackages.push(lockPkgName);
            findUpdateType(lockPkgName, collated.packages[name].updateType);
          } else {
            const pkgType = _.get(collated.packages, [lockPkgName, "updateType"], 0);
            const updateType = _.max([collated.packages[name].updateType, pkgType]);
            collated.packages[lockPkgName].updateType = updateType;
          }
        }
      }
    });

    // update any package that depend on a directly bumped packages or its version locks

    // generate the map { pkgName: [] } where value is the names of dependencies that changed
    const forceUpdatesMap = {};
    collated.realPackages.reduce((updates, name) => {
      const dependents = _.get(this._data.packages, [name, "dependents"], {});
      dependents.forEach((dep) => {
        if (!collated.forcePackages.includes(dep)) {
          collated.forcePackages.push(dep);
        }
        updates[dep] ??= [];
        updates[dep].push(name);
      });
      return updates;
    }, forceUpdatesMap);

    let count = 0;
    do {
      count = 0;
      for (const name of collated.forcePackages) {
        const pkgType = _.get(collated.packages, [name, "updateType"], 0);
        const deps = forceUpdatesMap[name];
        const updateTypes = deps
          .map((depName) => collated.packages[depName])
          .map((x) => x.updateType);
        const minBumpType = _.max([pkgType, ...updateTypes]);

        if (collated.realPackages.includes(name)) {
          if (minBumpType !== pkgType) {
            collated.packages[name].updateType = minBumpType;
            count++;
          }
        } else {
          findUpdateType(name, minBumpType);
        }
      }
    } while (count > 0);

    // check for version locking of indirect bump packages
    collated.forcePackages.forEach((name) => {
      const verLocks = this._versionLockMap[name];
      if (verLocks) {
        console.log("verLocks", name, verLocks);
        for (const lockPkgName of _.without(verLocks, name)) {
          if (!collated.forcePackages.includes(lockPkgName)) {
            collated.forcePackages.push(lockPkgName);
            findUpdateType(lockPkgName, collated.packages[name].updateType);
          }
        }
      }
    });

    // find version from updateType for both direct and indirect bumps
    for (const [name, pkg] of Object.entries(collated.packages)) {
      findVersion(name, (pkg as any).updateType);
    }

    const directBumps = collated.realPackages.filter(
      (name) => collated.packages[name] && collated.packages[name].newVersion
    );

    const indirectBumps = collated.forcePackages.filter(
      (name) =>
        !collated.realPackages.includes(name) &&
        collated.packages[name] &&
        collated.packages[name].newVersion
    );

    collated.directBumps = directBumps;
    collated.indirectBumps = indirectBumps;
    return Promise.resolve(collated);
  };

  getTaggedVersion = (pkg, fynpoRc) => {
    const newVer = pkg.newVersion;
    const semv = pkg.semver;

    const fynpoTags = _.get(fynpoRc, "command.publish.tags");
    const graduatePkgs = _.get(fynpoRc, "graduate", []);
    const graduateAll = graduatePkgs[0] && graduatePkgs[0] === "*";

    if (fynpoTags) {
      for (const tag in fynpoTags) {
        if (!tag.match(/^[0-9A-Za-z-]+$/)) {
          throw new Error(`tag ${tag} invalid. Only [0-9A-Za-z-] characters allowed.`);
        }
        const tagInfo = fynpoTags[tag];
        if (tagInfo.enabled === false) continue;
        const enabled = _.get(tagInfo, ["packages", pkg.originalPkg.name]);
        if (enabled) {
          if (tag !== "latest" && tagInfo.addToVersion) {
            if (semv.prerelease[0] && semv.prerelease[0] === tag) {
              return semv.inc("prerelease").format();
            }
            return `${pkg.newVersion}-${tag}.0`;
          }
        }
      }
    }

    if (semv.prerelease && semv.prerelease.length > 0) {
      if (graduateAll || graduatePkgs.indexOf(pkg.originalPkg.name) >= 0) {
        return semver.parse(pkg.versionOnly);
      }
      return semv.inc("prerelease").format();
    }

    return newVer;
  };

  updateChangelog = (collated) => {
    const d = new Date();
    const output = [];

    const forceUpdated = collated.indirectBumps.length > 0;

    let rootPkg;
    try {
      rootPkg = require(Path.join(this._cwd, "package.json"));
    } catch (err) {
      rootPkg = {};
    }

    output.push(`# ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}\n\n## Packages\n\n`);
    if (forceUpdated) {
      output.push(`### Directly Updated\n\n`);
    }

    const emitPackageMsg = (p, packages) => {
      const pkg = packages[p];
      const newVer = this.getTaggedVersion(pkg, this._fynpoRc);
      if (pkg.originalPkg.private) return;
      /* eslint-disable no-useless-concat */
      output.push(`-   \`${p}@${newVer}\` ` + "`" + `(${pkg.version} => ${newVer})` + "`\n");
    };
    collated.directBumps.sort().forEach((p) => emitPackageMsg(p, collated.packages));

    if (forceUpdated) {
      output.push(`\n### Fynpo Updated\n\n`);
      collated.indirectBumps.sort().forEach((p) => emitPackageMsg(p, collated.packages));
    }
    output.push(`\n## Commits\n\n`);

    let repoUrl = _.get(rootPkg, "repository.url", "REPO_URL").trim();
    if (repoUrl.endsWith(".git")) {
      repoUrl = repoUrl.slice(0, -4);
    }
    const commitUrl = `${repoUrl}/commit`;
    const prUrl = `${repoUrl}/pull`;

    const linkifyPR = (x) => x.replace(/\(#([0-9]+)\)$/, `([#$1](${prUrl}/$1))`);

    const emitCommitMsg = (msg) => {
      emitCommitMsg[msg.id] = true;
      output.push(`    -   ${linkifyPR(msg.m)} [commit](${commitUrl}/${msg.id})\n`);
    };

    const outputCommitMsgs = (items, prefix) => {
      const keys = Object.keys(items);
      if (keys.length === 0) return;
      keys.sort().forEach((p) => {
        const pkg = items[p];
        const dirName = pkg.dirName || p;
        if (!pkg.msgs || pkg.msgs.length === 0) return;
        output.push("-   `" + prefix + dirName + "`\n\n");
        pkg.msgs.slice().reverse().forEach(emitCommitMsg);
        output.push("\n");
      });
    };

    const outputPkgCommitMsgs = (group, prefix) => {
      const items = collated[group];
      outputCommitMsgs(items, prefix ? group + "/" : "");
    };

    outputPkgCommitMsgs("packages", true);
    outputPkgCommitMsgs("samples", true);
    outputPkgCommitMsgs("others", false);
    const filesItems = Object.keys(collated.files).reduce(
      (a, x) => {
        a.MISC.msgs = a.MISC.msgs.concat(
          collated.files[x].msgs.filter((msg) => {
            if (!emitCommitMsg[msg.id]) {
              return (emitCommitMsg[msg.id] = true);
            }
            return false;
          })
        );
        return a;
      },
      { MISC: { msgs: [] } }
    );
    outputCommitMsgs(filesItems, "");

    const updateText = output.join("");
    Fs.writeFileSync(this._changeLogFile, `${updateText}${this._changeLog}`);
  };

  commitChangeLogFile = (gitClean) => {
    logger.info("Change log updated.");
    if (!gitClean) {
      logger.warn("Your git branch is not clean, skip committing changelog file");
      return;
    }
    return this._sh(`git add ${this._changeLogFile} && git commit -m "Update changelog"`)
      .then(() => {
        logger.info("Changelog committed");
      })
      .catch((e) => {
        logger.error("Commit changelog failed", e);
      });
  };

  async exec() {
    return this.checkIfTagExists()
      .then(this.listGitCommits)
      .then(this.collateCommitsPackages)
      .then(this.determinePackageVersions)
      .then(this.updateChangelog)
      .then(this.checkGitClean)
      .then(this.commitChangeLogFile);
  }
}
