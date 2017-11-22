"use strict";

const Fs = require("fs");
const Crypto = require("crypto");
const Path = require("path");
const Yml = require("js-yaml");
const _ = require("lodash");
const mkdirp = require("mkdirp");
const Promise = require("bluebird");
const Tar = require("tar");
const rimraf = Promise.promisify(require("rimraf"));
const writeFile = Promise.promisify(Fs.writeFile);
const optionalRequire = require("optional-require")(require);
const metas = Fs.readdirSync(Path.join(__dirname, "metas"));

const makePackage = options => {
  const customPkg = optionalRequire(`./pkg/${options.name}.json`, {});
  return _.merge(
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
    ]),
    customPkg
  );
};

const tmpDir = Path.join(__dirname, "package");
mkdirp.sync(tmpDir);
mkdirp.sync(Path.join(__dirname, "tgz"));

const modSum = optionalRequire("./pkg-sum.json", { default: {} });
let changed = 0;

Promise.resolve(metas)
  .each(m => {
    const f = Path.join(__dirname, "metas", m);
    const ymlStr = Fs.readFileSync(f).toString();
    const meta = Yml.safeLoad(ymlStr);

    return Promise.resolve(Object.keys(meta.versions)).each(v => {
      const pkg = makePackage(meta.versions[v]);
      const fname = `${pkg.name}-${pkg.version}.tgz`;
      const file = Path.join(__dirname, "tgz", fname);
      const pkgJson = `${JSON.stringify(pkg, null, 2)}\n`;
      const sum = Crypto.createHash("md5")
        .update(pkgJson)
        .digest("hex");
      if (modSum[fname] === sum) return undefined;
      changed++;
      console.log("updating/creating", fname, modSum[fname], sum);
      modSum[fname] = sum;
      return writeFile(Path.join(tmpDir, "package.json"), pkgJson).then(() => {
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
    if (changed > 0) {
      Fs.writeFileSync(
        Path.join(__dirname, "pkg-sum.json"),
        `${JSON.stringify(modSum, null, 2)}\n`
      );
    }
    rimraf.sync(tmpDir);
  });
