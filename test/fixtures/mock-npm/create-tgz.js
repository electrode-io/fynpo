"use strict";

const Fs = require("fs");
const Crypto = require("crypto");
const Path = require("path");
const Yml = require("js-yaml");
const _ = require("lodash");
const mkdirp = require("mkdirp");
const Promise = require("bluebird");
const Tar = require("tar");
const xsh = require("xsh");
const rimraf = Promise.promisify(require("rimraf"));
const writeFile = Promise.promisify(Fs.writeFile);
const optionalRequire = require("optional-require")(require);
const metas = Fs.readdirSync(Path.join(__dirname, "metas"));

const makePackage = options => {
  const customPkg = optionalRequire(`./pkg/${options.name}/pkg.json`, {});
  const customVerPkg = optionalRequire(`./pkg/${options.name}/${options.version}/pkg.json`, {});
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
      "description",
      "bin",
      "scripts",
      "license",
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "os",
      "cpu"
    ]),
    customPkg,
    customVerPkg
  );
};

const TGZ_DIR_NAME = ".tgz";

const createTgz = () => {
  const modSum = optionalRequire(`./${TGZ_DIR_NAME}/pkg-sum.json`, { default: {} });
  let changed = 0;
  const tmpDir = Path.join(__dirname, "package");
  mkdirp.sync(Path.join(__dirname, TGZ_DIR_NAME));

  return Promise.resolve(metas)
    .each(m => {
      const f = Path.join(__dirname, "metas", m);
      const ymlStr = Fs.readFileSync(f).toString();
      const meta = Yml.safeLoad(ymlStr);

      return Promise.resolve(Object.keys(meta.versions)).each(v => {
        rimraf.sync(tmpDir);
        mkdirp.sync(tmpDir);

        const metaPkg = meta.versions[v];
        const pkg = makePackage(metaPkg);
        const fname = `${pkg.name}-${pkg.version}.tgz`;
        const file = Path.join(__dirname, TGZ_DIR_NAME, fname);
        const pkgJson = `${JSON.stringify(pkg, null, 2)}\n`;
        const sum = Crypto.createHash("md5")
          .update(pkgJson)
          .digest("hex");
        if (modSum[fname] === sum) return undefined;
        changed++;
        console.log("updating/creating", fname, modSum[fname], sum);
        modSum[fname] = sum;

        return writeFile(Path.join(tmpDir, "package.json"), pkgJson)
          .then(() => {
            const pkgDir = Path.join(
              Path.join(__dirname, "pkg", metaPkg.name, metaPkg.version, "package")
            );
            console.log("package dir", pkgDir);
            if (Fs.existsSync(pkgDir)) {
              xsh.$.cp("-Rf", `${pkgDir}/*`, tmpDir);
            }
          })
          .then(() => {
            return Tar.c(
              {
                gzip: true,
                file,
                cwd: __dirname
              },
              ["package"]
            ).then(() => {
              metaPkg.dist = {
                shasum: "",
                tarball: `http://localhost:4873/${pkg.name}/-/${fname}`
              };
            });
          })
          .then(() => {
            return writeFile(Path.join(__dirname, "metas", m), Yml.dump(meta));
          });
      });
    })
    .catch(e => {
      console.log(e.stack);
    })
    .finally(() => {
      if (changed > 0) {
        Fs.writeFileSync(
          Path.join(__dirname, TGZ_DIR_NAME, "pkg-sum.json"),
          `${JSON.stringify(modSum, null, 2)}\n`
        );
      }
      rimraf.sync(tmpDir);
    });
};

module.exports = createTgz;

if (require.main === module) {
  createTgz();
}
