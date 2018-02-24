const Fs = require("fs");

module.exports = {
  title: "should link bin",
  verify: () => {
    const modGPkg = JSON.parse(Fs.readFileSync(require.resolve("mod-g/package.json")));
    expect(modGPkg.version).to.equal("2.0.1");
  }
};
