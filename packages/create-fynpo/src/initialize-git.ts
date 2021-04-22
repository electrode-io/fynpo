import xsh from "xsh";

function _sh(command) {
  return xsh.exec(
    {
      silent: true,
      cwd: process.cwd(),
      env: Object.assign({}, process.env, { PWD: process.cwd() }),
    },
    command
  );
}
export function isGitInitialized() {
  return _sh(`git rev-parse --git-dir`)
    .then(() => true)
    .catch(() => false);
}

export function initializeGitRepo() {
  return _sh("git init");
}
