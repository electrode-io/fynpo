const Fs = require("fs");

module.exports = {
  title: "should link new bin and remove old ones when update dep",
  verify: () => {
    const modGPkg = JSON.parse(Fs.readFileSync(require.resolve("mod-g/package.json")));
    expect(modGPkg.version).to.equal("3.0.0");
  }
};
