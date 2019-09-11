#!/usr/bin/env node

"use strict";

require(require("./bundle"))
  .fun()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    process.exit(1);
  });
