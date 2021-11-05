//

module.exports = {
  title: "should remove a package from package.json",
  getArgs(options) {
    return [].concat(options.baseArgs).concat([`--layout=detail`, `remove`, `mod-a`, `mod-g`]);
  }
};
