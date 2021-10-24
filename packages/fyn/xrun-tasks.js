"use strict";

const Fs = require("./lib/util/file-ops");
const Path = require("path");
const mkdirp = require("mkdirp");
const rimraf = require("rimraf");
const which = require("which");

const { loadTasks, xrun } = require("@xarc/module-dev");
loadTasks();

xrun.load("fyn", {
  bundle: [xrun.exec("webpack"), "v8-compile-cache"],

  "v8-compile-cache": () => {
    const v8CompileCache = require.resolve("v8-compile-cache");
    const distPath = Path.join(__dirname, "dist");
    return xrun.exec(`cp ${v8CompileCache} ${distPath}`);
  },
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
