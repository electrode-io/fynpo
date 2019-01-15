"use strict";

if (require.main === module) {
  require("./main").run();
} else {
  module.exports = require("./main").run;
}
