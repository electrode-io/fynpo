/* eslint-disable  */

"use strict";

const start = Date.now();
const Module = require("module");

const symbols = Object.getOwnPropertySymbols(Module)
  .map(x => x.toString())
  .filter(x => x.indexOf("node-flat-module") >= 0);

if (symbols.length === 0) {
  console.log("fyn require node-flat-module loaded before startup");
  process.exit(1);
}

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../lib/fyn");
const PkgInstaller = require("../lib/pkg-installer");
const DepData = require("../lib/dep-data");
const fyn = new Fyn({
  registry: "http://localhost:4873/",
  // registry: "https://npme.walmart.com/",
  // registry: "https://registry.npmjs.org",
  // pkgFile: Path.join(__dirname, "fixtures/pkg.json"),
  pkgFile: Path.resolve("package.json"),
  targetDir: "node_modules",
  // regenOnly: true,
  localOnly: true
});
const logMemDiff = o => {
  const n = process.memoryUsage();
  const d = n.heapUsed - o.heapUsed;
  console.log("heap used diff", d / (1024 * 1024));
};
const m = process.memoryUsage();
fyn
  .resolveDependencies()
  .then(() => {
    logMemDiff(m);
    // Fs.writeFileSync(Path.resolve("fyn-data.yaml"), Yaml.dump(fyn._depResolver._data));
    return fyn.fetchPackages();
  })
  .then(() => {
    logMemDiff(m);
  })
  .then(() => {
    const installer = new PkgInstaller({ fyn });

    return installer.install();
  })
  .then(() => {
    const end = Date.now();
    console.log("done install in", (end - start) / 1000, "seconds");
  })
  .catch(err => {
    console.log("install failed", err);
  });
