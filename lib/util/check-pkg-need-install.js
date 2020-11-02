"use strict";

const { scanFileStats, latestCtimeTag } = require("./stat-dir");
const Fs = require("./file-ops");
const Path = require("path");

/**
 * Go into a local dep pkg's dir and see if it has one of these npm scripts:
 *
 * - preinstall
 * - postinstall
 *
 * **npm install run scripts**:
 *
 * - https://docs.npmjs.com/cli/v6/using-npm/scripts#npm-install
 * 1. preinstall
 * 2. install
 * 3. postinstall
 * 4. prepublish
 * 5. prepare
 *
 * If it does, then need to check if it has node_modules.
 *
 * - yes
 *     - is it fyn installed?
 *       - yes, then check fyn timestamp compare to files, is it outdated
 *         - yes, run fyn install and update timestamp
 *         - no, then all good
 *       - TODO: no, skip and log warning
 * - no, then run fyn install and set timestamp
 *
 */

const installScripts = ["preinstall", "install", "postinstall", "prepare", "build"];

async function checkPkgNeedInstall(dir, checkCtime = 0) {
  try {
    const pkgJson = JSON.parse(await Fs.readFile(Path.join(dir, "package.json")));
    const scripts = Object.keys(pkgJson.scripts || {});
    const hasScript = scripts.find(s => installScripts.includes(s));

    if (!hasScript) {
      return { install: false, hasScript, scripts };
    }

    const stats = await scanFileStats(dir);
    const ctime = stats[latestCtimeTag];

    return { install: ctime > checkCtime, ctime, checkCtime };
  } catch (error) {
    return { install: false, error };
  }
}

exports.checkPkgNeedInstall = checkPkgNeedInstall;
