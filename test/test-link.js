"use strict";

const Fs = require("fs");
const Path = require("path");
const Fyn = require("../lib/fyn");
const fyn = new Fyn({ pkgFile: Path.join(__dirname, "fixtures/pkg.json") });
const Yaml = require("js-yaml");
const DepData = require("../lib/dep-data");
// load data

const dataStr = Fs.readFileSync("fyn-data.yaml").toString();
const data = new DepData(Yaml.safeLoad(dataStr));

const PkgDepLinker = require("../lib/pkg-dep-linker");

const linker = new PkgDepLinker({ data, fyn });

linker.link();
