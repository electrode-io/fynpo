"use strict";

const Fs = require("fs");
const Path = require("path");
const mkdirp = require("mkdirp");
const rimraf = require("rimraf");
const xclap = require("xclap");

require("electrode-archetype-njs-module-dev")();

const pkgFile = Path.resolve("package.json");
let pkgData;

function readPkg() {
  if (!pkgData) {
    pkgData = Fs.readFileSync(pkgFile);
  }

  return pkgData;
}

xclap.load("fyn", {
  prepack: {
    task: () => {
      const dist = Path.resolve("dist");
      const data = readPkg();
      const pkg = JSON.parse(data);
      delete pkg.scripts;
      delete pkg.dependencies;
      delete pkg.nyc;
      delete pkg.devDependencies;
      rimraf.sync(dist);
      mkdirp.sync(dist);
      const fmSrc = require.resolve("flat-module/flat-module.js");
      const fmDist = Path.join(dist, "flat-module.js");
      Fs.writeFileSync(fmDist, Fs.readFileSync(fmSrc));

      mkdirp.sync(Path.resolve(".tmp"));
      Fs.writeFileSync(Path.resolve(".tmp/package.json"), data);
      Fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    }
  },

  postpack: {
    task: () => {
      Fs.writeFileSync(pkgFile, readPkg());
    }
  },

  release: ["fyn/bundle", "fyn/prepack", "fyn/publish", "fyn/postpack"],

  bundle: "webpack",

  publish: "npm publish"
});

