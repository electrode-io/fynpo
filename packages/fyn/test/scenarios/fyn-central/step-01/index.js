"use strict";

const Fs = require("fs");
const Path = require("path");
const assert = require("assert");

module.exports = {
  title: "should use a central storage",
  async before(cwd) {
    process.env.FYN_CENTRAL_DIR = Path.join(cwd, ".fyn", ".central");
  },
  after() {
    assert(Fs.existsSync(process.env.FYN_CENTRAL_DIR), "central storage not created");
    delete process.env.FYN_CENTRAL_DIR;
  }
};
