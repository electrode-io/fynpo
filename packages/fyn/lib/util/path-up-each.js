"use strict";

const Path = require("path");

module.exports = function pathUpEach(path, stopping) {
  const found = [];
  if (Array.isArray(stopping)) {
    const arr = stopping;
    stopping = x => arr.indexOf(Path.basename(x)) >= 0;
  }
  while (!stopping(path)) {
    found.push(path);
    const tmp = Path.join(path, "..");
    if (tmp === path) break;
    path = tmp;
  }
  return found;
};
