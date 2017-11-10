"use strict";

const Fs = require("fs");
const Path = require("path");
const Yml = require("js-yaml");
const _ = require("lodash");
const mkdirp = require("mkdirp");
const Promise = require("bluebird");
const Tar = require("tar");
const rimraf = Promise.promisify(require("rimraf"));
const writeFile = Promise.promisify(Fs.writeFile);

const metas = Fs.readdirSync(Path.join(__dirname, "metas"));

const makePackage = options => {
  return Object.assign(
    {},
    {
      name: "mod-a",
      version: "1.0.0",
      main: "index.js",
      scripts: {
        test: `echo "Error: no test specified" && exit 1`
      },
      keywords: [],
      author: "",
      license: "ISC",
      description: ""
    },
    _.pick(options, [
      "name",
      "version",
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "description"
    ])
  );
};

const tmpDir = Path.join(__dirname, "package");
mkdirp.sync(tmpDir);
mkdirp.sync(Path.join(__dirname, "tgz"));

Promise.resolve(metas)
  .each(m => {
    const f = Path.join(__dirname, "metas", m);
    const ymlStr = Fs.readFileSync(f).toString();
    const meta = Yml.safeLoad(ymlStr);

    return Promise.resolve(Object.keys(meta.versions)).each(v => {
      const pkg = makePackage(meta.versions[v]);
      return writeFile(
        Path.join(tmpDir, "package.json"),
        `${JSON.stringify(pkg, null, 2)}\n`
      ).then(() => {
        const file = Path.join(__dirname, "tgz", `${pkg.name}-${pkg.version}.tgz`);
        return Tar.c(
          {
            gzip: true,
            file,
            cwd: __dirname
          },
          ["package"]
        );
      });
    });
  })
  .catch(e => {
    console.log(e.stack);
  })
  .finally(() => {
    console.log("removing", tmpDir);
    rimraf.sync(tmpDir);
  });
