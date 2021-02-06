//

module.exports = {
  title: "should add a package to package.json",
  getArgs(options) {
    return [].concat(options.baseArgs).concat([`remove`, `mod-g`]);
  }
};
