#!/usr/bin/env node

require(require("./bundle"))
  .run()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.log(err);
    process.exit(1);
  });
