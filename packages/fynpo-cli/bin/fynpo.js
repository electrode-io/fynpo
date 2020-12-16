#!/usr/bin/env node
"use strict";

const requireAt = require("require-at");

try {
  requireAt(process.cwd(), "fynpo/cli/fynpo");
} catch (err) {
  if (err.code === "MODULE_NOT_FOUND") {
    console.error(`ERROR: Unable to find the fynpo module from dir ${process.cwd()}

Please make sure you are in a fynpo monorepo and you have installed fynpo
at its top level.
`);
  } else {
    console.error(
      `Fail to load fynpo for your monorepo from dir ${process.cwd()}
`,
      err
    );
  }
  process.exit(1);
}
