"use strict";

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../lib/fyn");
const fyn = new Fyn({
  opts: {
    registry: "http://localhost:4873/",
    pkgFile: Path.join(__dirname, "fixtures/pkg-a/package.json")
  }
});
fyn.resolveDependencies().then(() => {
  Fs.writeFileSync(Path.resolve("fyn-data.yaml"), Yaml.dump(fyn._depResolver._data));
});
