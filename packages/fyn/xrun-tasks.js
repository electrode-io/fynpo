"use strict";

const Fs = require("fs");
const FsAsync = require("./lib/util/file-ops");
const Path = require("path");
const which = require("which");

const { loadTasks, xrun } = require("@xarc/module-dev");
const xsh = require("xsh");
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
        const realPath = await FsAsync.realpath(fyn);
        const dist = Path.join(realPath, "../../dist/fyn.js");
        return xrun.exec(`cp dist/fyn.js ${dist}`);
      }
    ]
  },

  ".setup-gyp": {
    task: () => {
      const ng = `node_modules/node-gyp`;
      const nl = `node_modules/npm-lifecycle`;
      const fv = `${ng}/lib/Find-VisualStudio.cs`;
      const gyp = `${ng}/gyp`;
      const gypSrc = `${ng}/src`;
      const addonGypi = `${ng}/addon.gypi`;
      const gypBin = `${nl}/node-gyp-bin`;
      return () => {
        xsh.$.mkdir("-p", "dist");

        !Fs.existsSync(`dist/Find-VisualStudio.cs`) && xsh.$.cp(fv, "dist");

        if (!Fs.existsSync("gyp")) {
          xsh.$.cp("-r", gyp, ".");
          xsh.$.rm("-rf", "gyp/.flake8");
          xsh.$.rm("-rf", "gyp/.github");
          xsh.$.rm("-rf", "gyp/*.md");
        }

        if (!Fs.existsSync("src")) {
          xsh.$.cp("-r", gypSrc, ".");
        }

        xsh.$.cp(addonGypi, ".");

        !Fs.existsSync("node-gyp-bin") && xsh.$.cp("-r", gypBin, ".");
      };
    }
  },

  "link-npm-g": {
    desc: "Link 'npm i -g' version to source copy - for debugging",
    task: async () => {
      const fyn = await which("fyn");
      const realPath = await FsAsync.realpath(fyn);
      const bundlePath = Path.join(Path.dirname(realPath), "bundle.js");
      const main = Path.join(__dirname, "cli/main.js");
      await FsAsync.unlink(bundlePath);
      await FsAsync.writeFile(
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
