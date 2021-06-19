"use strict";

/* eslint-disable max-params */

const _ = require("lodash");
const Promise = require("bluebird");

exports.isWin32 = process.platform === "win32";

exports.retry = function retry(func, checks, tries, wait) {
  let p = Promise.try(func);

  if (!_.isEmpty(checks) && tries > 0 && wait > 0) {
    p = p.catch(err => {
      if (tries <= 0) throw err;
      tries--;
      return Promise.try(() =>
        Array.isArray(checks) ? checks.indexOf(err.code) >= 0 : checks(err)
      ).then(canRetry => {
        if (!canRetry) throw err;
        return Promise.delay(wait).then(() => retry(func, checks, tries, wait));
      });
    });
  }

  return p;
};
