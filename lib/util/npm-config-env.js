"use strict";

const { makeEnv } = require("npm-lifecycle");

/*
 * set all npmrc options into env with npm_config_ prefix
 */

function npmConfigEnv(data, config, env) {
  return makeEnv(data, { config: config }, undefined, env);
}

module.exports = npmConfigEnv;
