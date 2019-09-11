"use strict";

require("./main")
  .fun()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    process.exit(1);
  });
