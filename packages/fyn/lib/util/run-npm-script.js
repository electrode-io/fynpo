"use strict";

const Promise = require("bluebird");
const LifecycleScripts = require("../lifecycle-scripts");
const chalk = require("chalk");
const logFormat = require("./log-format");
const logger = require("../logger");

const { INSTALL_PACKAGE } = require("../log-items");

const running = [];
const updateRunning = s => {
  logger.updateItem(INSTALL_PACKAGE, `running ${s}: ${running.join(", ")}`);
};

const removeRunning = (step, pkgId) => {
  const x = running.indexOf(pkgId);
  running.splice(x, 1);
  updateRunning(step);
};

/**
 * Add npm lifecycle pre and post scripts to an array of scripts
 *
 * @param {*} scripts - array of scripts
 * @param {*} pkgScripts - scripts from package.json
 * @returns
 */
function addNpmLifecycle(scripts, pkgScripts) {
  return []
    .concat(scripts)
    .filter(x => x)
    .reduce((added, script) => {
      if (
        pkgScripts[script] !== undefined &&
        !script.startsWith("pre") &&
        !script.startsWith("post")
      ) {
        added.push(`pre${script}`);
        added.push(script);
        added.push(`post${script}`);
      } else {
        added.push(script);
      }

      return added;
    }, [])
    .filter(x => x && pkgScripts[x] !== undefined);
}

/**
 * Run a npm script with visual terminal display
 *
 * @param {*} param0
 * @returns
 */
const runNpmScript = ({ appDir, fyn, scripts, depInfo, ignoreFailure, withLifecycle = false }) => {
  const pkgId = logFormat.pkgId(depInfo);

  if (withLifecycle) {
    scripts = addNpmLifecycle(scripts, fyn._pkg.scripts || {});
  }

  return Promise.each(scripts, script => {
    running.push(pkgId);
    updateRunning(script);
    const ls = new LifecycleScripts(Object.assign({ appDir, _fyn: fyn }, depInfo));
    return ls
      .execute(script, true)
      .then(() => undefined)
      .catch(e => {
        if (!ignoreFailure) throw e;
        logger.warn(
          chalk.yellow(`ignoring failure of npm script ${script} of ${pkgId}`, chalk.red(e.message))
        );
        return e;
      })
      .finally(() => {
        removeRunning(script, pkgId);
      });
  });
};

module.exports = { addNpmLifecycle, runNpmScript };
