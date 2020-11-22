"use strict";

const Fs = require("opfs");
const Path = require("path");
const rimraf = require("rimraf");

module.exports = {
  title: "should install and run build when a local dep changed",
  buildLocal: true,
  forceInstall: false,
  async before() {
    const e1Dir = Path.join(__dirname, "../../../fixtures/e1");
    const fileName = Path.join(e1Dir, "package.json");
    const pkg = JSON.parse(await Fs.readFile(fileName));
    pkg.scripts.install = "node index.js hello.js";
    await Fs.writeFile(fileName, JSON.stringify(pkg, null, 2));
    rimraf.sync(Path.join(e1Dir, "dist"));
  }
};
