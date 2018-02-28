const Fs = require("fs");
const Path = require("path");

module.exports = {
  title: "should update nested dep away from local if unlocked",
  before: () => Fs.unlinkSync(Path.join(__dirname, "../fyn-lock.yaml"))
};
