"use strict";

const Fs = require("opfs");
const Path = require("path");
const xaa = require("xaa");
const assert = require("assert");

module.exports = {
  title: "should do nothing when no files changed",
  buildLocal: true,
  forceInstall: false,
  async before(cwd) {
    await xaa.delay(10);
  },
  async verify(cwd) {
    const debugLog = (await Fs.readFile(Path.join(cwd, "fyn-debug-step-02.log"))).toString();
    assert(
      debugLog.includes("nothing to be done"),
      "fyn-debug-step-02.log doesn't contain string 'nothing to be done'"
    );
  }
};
