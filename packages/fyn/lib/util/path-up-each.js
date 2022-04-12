"use strict";

/* eslint-disable no-param-reassign */

const Path = require("path");

/*
 * Take a path and do "cd .." on it, pushing each new dir
 * into an array, until either:
 *
 * 1. Can't "cd .."" anymore
 * 2. The array stopping contains Path.basename(dir)
 *
 * stopping can also be a callback that returns true to
 * stop the process.
 */

module.exports = function pathUpEach(path, stopping) {
  const found = [];

  if (Array.isArray(stopping)) {
    const arr = stopping;
    stopping = x => arr.indexOf(Path.basename(x)) >= 0;
  }

  while (path && path !== "." && !stopping(path)) {
    found.push(path);
    const tmp = Path.join(path, "..");
    if (tmp === path) break;
    path = tmp;
  }

  return found;
};
