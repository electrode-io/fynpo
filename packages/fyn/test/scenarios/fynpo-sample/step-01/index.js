const Fs = require("fs");
const Path = require("path");
const { expect } = require("chai");
const { before } = require("../../fyn-central/step-01");

module.exports = {
  title: "should handle a fynpo monorepo",
  pkgDir: "@scope/pkg-2",
  timeout: 10000,
  async before(cwd, scenarioDir) {
    try {
      Fs.unlinkSync(Path.join(scenarioDir, ".fynpo-data.json"));
    } catch (_err) {
      //
    }
  },
  async verify(cwd, scenarioDir) {
    const fynData = JSON.parse(Fs.readFileSync(Path.join(scenarioDir, ".fynpo-data.json")));
    const eData = JSON.parse(Fs.readFileSync(Path.join(__dirname, "_fynpo-data.json")));
    expect(fynData.indirects).to.deep.equal(eData.indirects);
  }
};
