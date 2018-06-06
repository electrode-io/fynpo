"use strict";

const Fs = require("fs");
const Promise = require("bluebird");
const mkdirp = require("mkdirp");
const rimraf = require("rimraf");

const fileOps = {};

Object.keys(Fs)
  .filter(
    x =>
      typeof Fs[x] === "function" &&
      !x.endsWith("Sync") &&
      !x.startsWith("_") &&
      x[0] === x[0].toLowerCase()
  )
  .forEach(f => {
    fileOps[f] = Promise.promisify(Fs[f], { context: Fs });
  });

module.exports = Object.assign(fileOps, {
  mkdirp: Promise.promisify(mkdirp),
  rimraf: Promise.promisify(rimraf)
});
