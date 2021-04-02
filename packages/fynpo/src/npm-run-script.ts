/* copied from https://github.com/lerna/lerna/blob/main/utils/npm-run-script/npm-run-script.js */
import { spawnStreaming, exec } from "./child-process";

const makeOpts = (pkg, reject) => {
  return {
    cwd: pkg.path,
    reject,
    pkg,
  };
};

export const npmRunScript = (script, { args, npmClient, pkg, reject = true }) => {
  const argv = ["run", script, ...args];
  const opts = makeOpts(pkg, reject);

  return exec(npmClient, argv, opts);
};

export const npmRunScriptStreaming = (script, { args, npmClient, pkg, prefix, reject = true }) => {
  const argv = ["run", script, ...args];
  const opts = makeOpts(pkg, reject);

  return spawnStreaming(npmClient, argv, opts, prefix && pkg.name);
};
