"use strict";

/* eslint-disable no-process-exit */

module.exports = function exit(err) {
  process.exit(err ? 1 : 0);
};
