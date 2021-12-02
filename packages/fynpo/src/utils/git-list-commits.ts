import Promise from "bluebird";
import Path from "path";
import Fs from "fs";
import minimatch from "minimatch";
import { logger } from "../logger";
import { execSync } from "../child-process";

const xrequire = eval("require");

export const isAnythingCommitted = (opts) => {
  const anyCommits = execSync("git", ["rev-list", "--count", "--all", "--max-count=1"], opts);

  return Boolean(parseInt(anyCommits, 10));
};

export const getNewCommits = (opts, changed) => {
  const execOpts = {
    cwd: opts.cwd,
  };

  const tag = changed.latestTag;

  let args;
  if (tag) {
    args = ["log", `${tag}...HEAD`, "--pretty=format:'%H %s'"];
  } else {
    args = ["log", "--pretty=format:'%H %s'"];
  }

  const stdout = execSync("git", args, execOpts);
  const commits = stdout
    .split("\n")
    .map((x) => x.replace(/['"]+/g, ""))
    .filter(
      (x) => x.length > 0 && !x.startsWith("Merge pull request #") && !x.includes("[no-changelog]")
    );
  const commitIds = commits.reduce(
    (a, x) => {
      const idx = x.indexOf(" ");
      const id = x.substr(0, idx);
      a.ids.push(id);
      a[id] = x.substr(idx + 1);
      return a;
    },
    { ids: [] }
  );

  return Promise.resolve(commitIds).then((commitObj) => {
    if (opts.changeLog.indexOf(commitObj.ids[0]) >= 0) {
      logger.error("change log already contain a commit from new commits");
      process.exit(1);
    }
    return { commits: commitObj, changed, opts };
  });
};

export const collateCommitsPackages = ({ commits, changed, opts }) => {
  const commitIds = commits.ids;
  const execOpts = {
    cwd: opts.cwd,
  };

  const collated = {
    realPackages: [],
    packages: {},
    samples: {},
    others: {},
    files: {},
    changed,
    opts,
  };

  const ignoreChanges = opts.ignoreChanges || [];
  if (ignoreChanges.length) {
    logger.info("Ignoring commits in files matching patterns:", ignoreChanges);
  }
  const filterFunctions = ignoreChanges.map((p) =>
    minimatch.filter(`!${p}`, {
      matchBase: true,
      dot: true,
    })
  );

  return Promise.map(
    commitIds,
    (id) => {
      const args = ["diff-tree", "--no-commit-id", "--name-only", "--root", "-r", `${id}`];
      const stdout = execSync("git", args, execOpts);
      let files = stdout.split("\n").filter((x) => x.trim().length > 0);

      if (filterFunctions.length) {
        for (const filerFn of filterFunctions) {
          files = files.filter(filerFn);
        }
      }

      const handled = { packages: {}, others: {}, files: {} };

      files.reduce((a, x) => {
        const parts = x.split("/");
        const add = (group, key) => {
          if (handled[group][key]) return;
          a[group][key] ??= {};
          if (!a[group][key].msgs) {
            a[group][key].msgs = [];
          }
          a[group][key].msgs.push({ m: commits[id], id });
          handled[group][key] = true;
        };

        if (parts[0] === "packages" || parts[0] === "samples") {
          if (Fs.existsSync(Path.resolve("packages", parts[1]))) {
            /* eslint-disable @typescript-eslint/no-var-requires */
            const Pkg = xrequire(Path.resolve("packages", parts[1], "package.json"));
            if (parts[0] === "packages" && collated.realPackages.indexOf(Pkg.name) < 0) {
              collated.realPackages.push(Pkg.name);
              a.packages[Pkg.name] = { dirName: parts[1] };
            }
            add(parts[0], Pkg.name);
          }
        } else if (parts.length > 1) {
          add("others", parts[0]);
        } else {
          add("files", parts[0]);
        }

        return a;
      }, collated);
      return "";
    },
    { concurrency: 1 }
  ).then(() => collated);
};
