"use strict";

const Fs = require("fs");
const Path = require("path");

module.exports = {
  title: "should install with locked version",
  before(cwd) {
    const npmLock = Fs.readFileSync(Path.join(__dirname, "npm-lock.json"));
    Fs.writeFileSync(Path.join(cwd, "package-lock.json"), npmLock);
  }
};
