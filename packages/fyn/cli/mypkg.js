"use strict";

/*
 * Avoid webpack bundling the whole package.json if doing require("../package.json")
 */

const Fs = require("fs");
const Path = require("path");

const myPkg = JSON.parse(Fs.readFileSync(Path.join(__dirname, "../package.json")));

module.exports = myPkg;
