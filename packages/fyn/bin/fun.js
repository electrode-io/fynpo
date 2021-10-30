#!/usr/bin/env node

"use strict";

require("./index")
  .fun()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
