import Fs from "opfs";
import Path from "path";
import _ from "lodash";
import shcmd from "shcmd";

const xrequire = eval("require"); // eslint-disable-line

export const sortObjKeys = (obj) => {
  return _(obj).toPairs().sortBy(0).fromPairs().value();
};

export const sortPackageDeps = (pkg) => {
  ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].forEach((x) => {
    if (pkg[x]) {
      const dep = {};
      for (const key in pkg[x]) {
        if (pkg[x][key] !== "-") {
          dep[key] = pkg[x][key];
        }
      }
      pkg[x] = exports.sortObjKeys(dep);
    }
  });
};

export const myPkg = xrequire("../package.json");

export function getCommitLintSetting() {
  return {
    scripts: {
      prepare: "husky install",
    },
    devDependencies: {
      "@commitlint/config-conventional": "^12.0.1",
      husky: "^5.1.3",
    },
  };
}

// eslint-disable-next-line
export async function copyTemplate(srcTmplDir, destDir, filesList) {
  const destFile = (name) => Path.join(destDir, name);

  for (const name in filesList) {
    const file = filesList[name];
    const fullSrc = Path.join(srcTmplDir, name);

    if (!Fs.existsSync(fullSrc) && file.fromTemplate !== false) {
      continue;
    }

    if (file.dir) {
      Fs.$.mkdirpSync(destFile(file.destName || name));
    } else if (file.processor) {
      const content = Fs.readFileSync(fullSrc, "utf-8");
      Fs.writeFileSync(destFile(file.destName || name), file.processor(content));
    } else if (file.loader) {
      const content = file.loader(fullSrc);
      Fs.writeFileSync(destFile(file.destName || name), content);
    } else {
      shcmd.cp(fullSrc, destFile(file.destName || name));
    }
  }
}
