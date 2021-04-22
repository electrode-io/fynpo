import Path from "path";
import _ from "lodash";
import ck from "chalker";

const xrequire = eval("require"); // eslint-disable-line

import { copyTemplate, sortPackageDeps, getCommitLintSetting } from "./utils";
import { prepareFynpoDir, checkDir } from "./prep-fynpo-dir";
import { ParsedObj } from "./interfaces";
import { isGitInitialized, initializeGitRepo } from "./initialize-git";

export async function createFynpo(targetDir, opts) {
  const fynpoDir = await prepareFynpoDir(targetDir);
  const dirOk = await checkDir(fynpoDir);

  if (!dirOk) {
    console.log(`Not able to write to directory '${fynpoDir}'. bye.`);
    return;
  }

  const isGit = await isGitInitialized();

  if (!isGit) {
    console.log("Initializing Git repository");
    await initializeGitRepo();
  }

  const commitlint = opts && opts.commitlint;
  const srcDir = Path.join(__dirname, "../templates");
  const configFile = commitlint ? "fynpo.config.js" : "fynpo.json";
  const fynpoRc = {
    changeLogMarkers: ["## Packages", "## Commits"],
    command: { publish: { tags: {}, versionTagging: {} } },
  };

  const files = {
    packages: { dir: true, fromTemplate: false },
    _gitignore: { destName: ".gitignore" },
    _npmrc: { destName: ".npmrc" },
    [configFile]: {
      fromTemplate: commitlint ? true : false,
      loader: !commitlint ? () => `${JSON.stringify(fynpoRc, null, 2)}\n` : undefined,
    },
    "README.md": {},
    "_package.js": {
      loader: (filename) => {
        let pkg;
        const makePkg = xrequire(filename);
        if (commitlint) {
          const lint = getCommitLintSetting();
          pkg = makePkg(lint, _.merge);
        } else {
          pkg = makePkg({}, _.merge);
        }
        sortPackageDeps(pkg);
        return `${JSON.stringify(pkg, null, 2)}\n`;
      },
      destName: "package.json",
    },
  };

  await copyTemplate(srcDir, process.cwd(), {
    ...files,
  });

  const commitHookMsg = commitlint
    ? `\nTo add commit hooks, please run:
        <cyan>
        npx husky add .husky/commit-msg 'npx --no-install fynpo commitlint --edit $1'</>
        `
    : "";

  console.log(ck`
Successfully initialized fynpo monorepo in directory '${fynpoDir}'. To start development, please run:
<cyan>cd ${fynpoDir}
fyn</>
${commitHookMsg}
`);
}

export async function create(parsed: ParsedObj): Promise<void> {
  const dir = parsed.args?.dir || ".";
  return await createFynpo(dir, parsed.opts);
}
