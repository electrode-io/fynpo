"use strict";
const rimraf = require("rimraf");
const Path = require("path");
// test
const Fs = require("fs");

const distDir = Path.join(__dirname, "dist");
if (!Fs.existsSync(distDir)) {
  try {
    rimraf.sync(distDir);
    Fs.mkdirSync(distDir);
  } catch (err) {
    //
  }
  const fileName = process.argv[2];
  Fs.writeFileSync(
    Path.join(distDir, fileName),
    `console.log("test");
`
  );
} else {
  console.log("e1 dist already exist");
}
//# fynSourceMap=true
//# sourceMappingURL=index.js.map
