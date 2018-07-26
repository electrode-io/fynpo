"use strict";

/* eslint-disable max-params */

/*
 * clone another directory by:
 * - Creating the same directories
 * - Hard link physical files
 * - Transfer symlinks (ensure the same symlink name exist but with target adjusted)
 */

const Path = require("path");
const Fs = require("./file-ops");
const xaa = require("./xaa");
const npmPacklist = require("npm-packlist");
const fynTil = require("./fyntil");

async function linkFile(srcFp, destFp, srcStat) {
  try {
    return await Fs.link(srcFp, destFp);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;

    if (srcStat === undefined) srcStat = await Fs.stat(srcFp);

    if (!srcStat) throw e;

    const destStat = await Fs.stat(destFp);

    if (srcStat.ino !== destStat.ino) {
      await Fs.unlink(destFp);
      return await linkFile(srcFp, destFp, null);
    }
  }

  return undefined;
}

async function prepDestDir(dest) {
  const statDest = await xaa.try(() => Fs.lstat(dest));

  const destFiles = {};

  if (!statDest) {
    try {
      await Fs.mkdir(dest);
    } catch (e) {
      await Fs.$.mkdirp(dest);
    }
  } else if (!statDest.isDirectory()) {
    await Fs.unlink(dest);
    return prepDestDir(dest);
  } else {
    (await Fs.readdir(dest)).forEach(x => (destFiles[x] = false));
  }

  return destFiles;
}

async function cleanExtraDest(dest, destFiles) {
  for (const k in destFiles) {
    if (destFiles[k] === false) {
      await Fs.$.rimraf(Path.join(dest, destFiles[k]));
    }
  }
}

const FILES = Symbol("files");

async function generatePackTree(path) {
  const files = await npmPacklist({
    path
  });

  const fmap = { [FILES]: [] };

  files.forEach(filePath => {
    const dir = Path.dirname(filePath);
    if (dir === ".") {
      fmap[FILES].push(filePath);
      return;
    }

    let dmap = fmap;
    dir.split(Path.sep).forEach(d => {
      if (!dmap[d]) {
        dmap[d] = { [FILES]: [] };
      }
      dmap = dmap[d];
    });

    dmap[FILES].push(Path.basename(filePath));
  });

  return fmap;
}

async function linkPackTree(tree, src, dest, sym1) {
  const files = tree[FILES];

  const destFiles = await prepDestDir(dest);

  for (const file of files) {
    destFiles[file] = true;
    const srcFp = Path.join(src, file);
    const destFp = Path.join(dest, file);
    await linkFile(srcFp, destFp);
  }

  for (const dir in tree) {
    destFiles[dir] = true;
    const srcFp = Path.join(src, dir);
    const destFp = Path.join(dest, dir);
    if (!sym1) {
      await linkPackTree(tree[dir], srcFp, destFp);
    } else {
      // make symlink to directories in the top level
      await fynTil.symlinkDir(destFp, srcFp);
    }
  }

  // any file exist in dest but not in src are removed
  await cleanExtraDest(dest, destFiles);
}

async function link(src, dest) {
  const tree = await generatePackTree(src);

  return await linkPackTree(tree, src, dest);
}

async function linkSym1(src, dest) {
  const tree = await generatePackTree(src);

  return await linkPackTree(tree, src, dest, true);
}

module.exports = {
  link,
  linkSym1
};
