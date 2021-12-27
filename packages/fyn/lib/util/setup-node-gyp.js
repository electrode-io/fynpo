"use strict";

const Fs = require("fs");
const Path = require("path");
const requireAt = require("require-at");
const logger = require("../logger");
const { getGlobalNodeModules } = require("./fyntil");
const xsh = require("xsh");

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
    logger.debug(`failed to resolve node-gyp dir from npm ${version}, using defaults.`, err);
    return {
      envFile: Path.join(npmDir, "node_modules/node-gyp/bin/node-gyp.js"),
      envPath: _searchNodeGypBin({ npmDir })
    };
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
    logger.debug(`failed to resolve node-gyp dir from npm ${version}, using defaults.`, err);
    return {
      envFile: Path.join(npmDir, "node_modules/node-gyp/bin/node-gyp.js"),
      envPath: _searchNodeGypBin({ npmDir })
    };
  }
}

/**
 *
 * @param {*} env
 * @returns
 */
function setupNodeGypFromNpm(env) {
  const npmDir = Path.join(getGlobalNodeModules(), "npm");
  const xrequire = requireAt(npmDir);
  const npmPkg = xrequire("./package.json");
  const version = parseInt(npmPkg.version.split(".")[0]);

  if (version > 8) {
    logger.error(`Unknown npm version ${version} - can't provide node-gyp binary`);
    return;
  }

  const { envFile, envPath } =
    version <= 6
      ? _getNpm6NodeGyp({ version: npmPkg.version, npmDir, xrequire })
      : _getNpm7NodeGyp({ version: npmPkg.version, npmDir, xrequire });

  env.npm_config_node_gyp = envFile; // eslint-disable-line
  xsh.envPath.addToFront(envPath, env);

  logger.debug(`env npm_config_node_gyp set to ${env.npm_config_node_gyp}, path ${envPath} added`);
}

module.exports = {
  setupNodeGypFromNpm
};
