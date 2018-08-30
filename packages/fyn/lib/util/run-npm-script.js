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

const runNpmScript = ({ appDir, fyn, scripts, depInfo, ignoreFailure }) => {
  const pkgId = logFormat.pkgId(depInfo);

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
          chalk.yellow(`ignoring ${pkgId} npm script ${script} failure`, chalk.red(e.message))
        );
        return e;
      })
      .finally(() => {
        removeRunning(script, pkgId);
      });
  });
};

module.exports = runNpmScript;
