//

module.exports = {
  title: "should add a package to package.json",
  getArgs(options) {
    return []
      .concat(options.baseArgs)
      .concat([`add`, `mod-a`, `--dev`, `mod-d`, `../../fixtures/mod-g`]);
  }
};
