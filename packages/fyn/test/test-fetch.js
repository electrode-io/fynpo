"use strict";

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../lib/fyn");
const data = Yaml.safeLoad(Fs.readFileSync(Path.resolve("fyn-data.yaml").toString()));
const fyn = new Fyn({
  opts: { data, pkgFile: Path.join(__dirname, "fixtures/pkg-a/package.json") }
});

fyn.fetchPackages().then(() => {
  console.log("done fetching packages");
  Fs.writeFileSync(Path.resolve("fyn-fetch.yaml"), Yaml.dump(fyn._distFetcher._packages));
});
