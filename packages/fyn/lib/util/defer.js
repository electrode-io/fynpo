"use strict";

const Promise = require("bluebird");

module.exports = function _defer() {
  const defer = {};

  defer.promise = new Promise((resolve, reject) => {
    defer.resolve = resolve;
    defer.reject = reject;
  });

  return defer;
};
