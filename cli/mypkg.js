"use strict";

const Fs = require("fs");
const Path = require("path");

const myPkg = JSON.parse(Fs.readFileSync(Path.join(__dirname, "../package.json")));

module.exports = myPkg;
