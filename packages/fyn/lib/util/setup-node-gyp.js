"use strict";

const Fs = require("fs");
const Path = require("path");
const requireAt = require("require-at");
const logger = require("../logger");
const { getGlobalNodeModules } = require("./fyntil");
const xsh = require("xsh");
const fyntil = require("./fyntil");

let nodeGypBinPath;

function _searchNodeGypBin({ npmDir, searchPath }) {
  if (!nodeGypBinPath) {
    nodeGypBinPath = [
      searchPath,
      // npm 7 and above pull node-gyp directly and provides node-gyp-bin under its bin dir
      Path.join(npmDir, "bin/node-gyp-bin"),
      // npm 6 and lower uses npm-lifecycle package, which has its own node-gyp-bin
      Path.join(npmDir, "node_modules/npm-lifecycle/node-gyp-bin")
    ].find(path => path && Fs.existsSync(path));
  }

  return nodeGypBinPath;
}

function _getNpm6NodeGyp({ version, npmDir, xrequire }) {
  try {
    const npmLifecycleDir = Path.dirname(xrequire.resolve("npm-lifecycle/package.json"));
    return {
      envFile: xrequire.resolve("node-gyp/bin/node-gyp"),
      envPath: _searchNodeGypBin({
        npmDir,
        // search in npm-lifecycle's dir that's found through require
        searchPath: Path.join(npmLifecycleDir, "node-gyp-bin")
      })
    };
  } catch (err) {
    logger.debug(`failed to resolve node-gyp dir from npm ${version}`, err);
    return {};
  }
}

function _getNpm7NodeGyp({ version, npmDir, xrequire }) {
  try {
    return {
      // npm 7, 8 have node-gyp as dep directly
      envFile: xrequire.resolve("node-gyp/bin/node-gyp"),
      envPath: _searchNodeGypBin({ npmDir })
    };
  } catch (err) {
    logger.debug(`failed to resolve node-gyp dir from npm ${version}`, err);
    return {};
  }
}

/**
 *
 * @param {*} env
 * @returns
 */
function setupNodeGypFromNpm(env) {
  try {
    const npmDir = Path.join(getGlobalNodeModules(), "npm");
    const xrequire = requireAt(npmDir);
    const npmPkg = xrequire("./package.json");
    const version = parseInt(npmPkg.version.split(".")[0]);

    if (version <= 8) {
      const { envFile, envPath } =
        version <= 6
          ? _getNpm6NodeGyp({ version: npmPkg.version, npmDir, xrequire })
          : _getNpm7NodeGyp({ version: npmPkg.version, npmDir, xrequire });

      if (envFile && envPath) {
        env.npm_config_node_gyp = envFile; // eslint-disable-line
        xsh.envPath.addToFront(envPath, env);

        logger.debug(
          `using node-gyp from npm ${version}: env npm_config_node_gyp set to ${env.npm_config_node_gyp}, path ${envPath} added`
        );
        return true;
      }
    }
  } catch (err) {
    //
  }

  return false;
}

/**
 *
 * @param {*} env
 * @returns
 */
function setupNodeGypEnv(env) {
  if (process.env.FYN_NPM_NODE_GYP !== "false" && setupNodeGypFromNpm(env)) {
    return;
  }

  env.npm_config_node_gyp = Path.join(fyntil.fynDir, "bin/node-gyp.js"); // eslint-disable-line
  const envPath = Path.join(fyntil.fynDir, "node-gyp-bin");
  xsh.envPath.addToFront(envPath, env);
  logger.debug(
    `using fyn's node-gyp: env npm_config_node_gyp set to ${env.npm_config_node_gyp}, path ${envPath} added`
  );
}

module.exports = {
  setupNodeGypFromNpm,
  setupNodeGypEnv
};
