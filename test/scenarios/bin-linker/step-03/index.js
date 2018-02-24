const Fs = require("fs");

module.exports = {
  title: "should update link that changed",
  verify: () => {
    const modGPkg = JSON.parse(Fs.readFileSync(require.resolve("mod-g/package.json")));

    expect(modGPkg.version).to.equal("4.0.0");
  }
};
