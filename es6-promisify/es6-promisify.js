"use strict";

const Promise = require("bluebird");

module.exports = function promisify(func, context) {
  return Promise.promisify(func, { context });
};
