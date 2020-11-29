"use strict";

const Fs = require("opfs");
const Path = require("path");

module.exports = {
  title: "should install with locked version",
  async before(cwd) {
    const lockData = await Fs.readFile(Path.join(__dirname, "lock.yaml"));
    await Fs.writeFile(Path.join(cwd, "fyn-lock.yaml"), lockData);
  }
};
