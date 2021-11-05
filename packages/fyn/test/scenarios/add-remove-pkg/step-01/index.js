//

module.exports = {
  title: "should add packages to package.json",
  getArgs(options) {
    return []
      .concat(options.baseArgs)
      .concat([`--layout=detail`, `add`, `mod-a`, `--dev`, `mod-d`, `../../fixtures/mod-g`]);
  }
};
