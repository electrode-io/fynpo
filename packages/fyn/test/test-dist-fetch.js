"use strict";

const Path = require("path");
const Fyn = require("../lib/fyn");

const fyn = new Fyn({ opts: { pkgFile: Path.join(__dirname, "fixtures/pkg.json") } });
const Fs = require("fs");
const Yaml = require("js-yaml");

const data = Yaml.load(Fs.readFileSync("fyn-data.yaml").toString());
fyn.fetchPackages(data);
