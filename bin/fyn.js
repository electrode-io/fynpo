#!/usr/bin/env node

require(require("./bundle"))
  .run()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    process.exit(1);
  });
