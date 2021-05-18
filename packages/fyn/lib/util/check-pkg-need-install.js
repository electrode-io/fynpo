"use strict";

const { scanFileStats } = require("./stat-dir");
const Fs = require("./file-ops");
const Path = require("path");
const logger = require("../logger");

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

    //
    // if there's no check time, then there's no installation yet and fyn must execute
    // install, so a local dep's time would make no difference to fyn making that decision.
    // however, since there's no build script, fyn definitely doesn't need to run
    // install on a local dep, and we can immediately return false and skip a dir scan.
    //
    if (!hasScript && !checkCtime) {
      logger.debug(
        `package at ${dir} doesn't need local build because it doesn't have build scripts`
      );
      return { install: false, hasScript, scripts, pkgJson };
    }

    // fyn is running on existing install, must check a local dep's file times
    // to see if it changed and would affect fyn's decision to run install or not.

    const stats = await scanFileStats(dir);
    const ctime = stats.latestMtimeMs;
    const changed = ctime > checkCtime;

    return {
      changed,
      localBuild: changed && hasScript,
      checkCtime,
      pkgJson,
      stats,
      scripts,
      hasScript
    };
  } catch (error) {
    return { install: false, error };
  }
}

exports.checkPkgNeedInstall = checkPkgNeedInstall;
