"use strict";

const Fs = require("./lib/util/file-ops");
const Path = require("path");
const mkdirp = require("mkdirp");
const rimraf = require("rimraf");
const which = require("which");

const xrun = require("@xarc/module-dev")();

const pkgFile = Path.resolve("package.json");
let pkgData;

function readPkg() {
  if (!pkgData) {
    pkgData = Fs.readFileSync(pkgFile);
  }

  return pkgData;
}

xrun.load("fyn", {
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

      mkdirp.sync(Path.resolve(".tmp"));
      Fs.writeFileSync(Path.resolve(".tmp/package.json"), data);
      Fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  },

  postpack: {
    task: () => {
      Fs.writeFileSync(pkgFile, readPkg());
    }
  },

  ".prepare": ["fyn/prepack", "fyn/bundle"],

  release: {
    desc: "Release a new version to npm.  package.json must be updated.",
    task: ["create-tgz", "xarc/check", "fyn/.prepare", "fyn/publish"],
    finally: ["fyn/postpack"]
  },

  bundle: "webpack",

  publish: "npm publish",

  "replace-npm-g": {
    desc: "Replace the version that was installed by 'npm i -g' with current",
    task: [
      "fyn/bundle",
      async () => {
        const fyn = await which("fyn");
        const realPath = await Fs.realpath(fyn);
        const dist = Path.join(realPath, "../../dist/fyn.js");
        return xrun.exec(`cp dist/fyn.js ${dist}`);
      }
    ]
  },

  "link-npm-g": {
    desc: "Link 'npm i -g' version to source copy - for debugging",
    task: async () => {
      const fyn = await which("fyn");
      const realPath = await Fs.realpath(fyn);
      const bundlePath = Path.join(Path.dirname(realPath), "bundle.js");
      const main = Path.join(__dirname, "cli/main.js");
      await Fs.unlink(bundlePath);
      await Fs.writeFile(
        bundlePath,
        `
"use strict";
module.exports = "${main}";
`
      );
    }
  },

  "create-tgz": "node test/fixtures/mock-npm/create-tgz"
});
