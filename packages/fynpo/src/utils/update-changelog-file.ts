/* eslint-disable complexity, consistent-return, max-depth */

import Path from "path";
import Fs from "fs";
import semver from "semver";
import _ from "lodash";

const getTaggedVersion = (pkg, fynpoRc) => {
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

export const updateChangelog = (collated) => {
  const d = new Date();
  const output = [];
  const opts = collated.opts || {};
  const cwd = opts.cwd || process.cwd();
  const versions = {};
  const tags = [];

  const forceUpdated = collated.indirectBumps.length > 0;

  let rootPkg;
  try {
    rootPkg = require(Path.join(cwd, "package.json"));
  } catch (err) {
    rootPkg = {};
  }

  output.push(`# ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}\n\n## Packages\n\n`);
  if (forceUpdated) {
    output.push(`### Directly Updated\n\n`);
  }

  const emitPackageMsg = (p, packages) => {
    const pkg = packages[p];
    const newVer = getTaggedVersion(pkg, opts.fynpoRc);
    if (pkg.originalPkg.private) return;
    /* eslint-disable no-useless-concat */
    output.push(`-   \`${p}@${newVer}\` ` + "`" + `(${pkg.version} => ${newVer})` + "`\n");
    versions[p] = newVer;
    tags.push(`${p}@${newVer}`);
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
      pkg.msgs.slice().forEach(emitCommitMsg);
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
  Fs.writeFileSync(opts.changeLogFile, `${updateText}${opts.changeLog}`);
  return Promise.resolve({ versions, tags, collated });
};
