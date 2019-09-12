#!/usr/bin/env node

require(require("./bundle"))
  .run()
  .catch(err => {
    process.exit(1);
  });
