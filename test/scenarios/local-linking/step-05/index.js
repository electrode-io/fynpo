const Fs = require("fs");
const Path = require("path");

module.exports = {
  title: "should use local version for nested dep when unlocked",
  before: () => Fs.unlinkSync(Path.join(__dirname, "../fyn-lock.yaml"))
};
