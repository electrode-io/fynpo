"use strict";

/*
 * clone another directory by:
 * - Creating the same directories
 * - Hard link physical files
 * - Transfer symlinks (ensure the same symlink name exist but with target adjusted)
 */

const Path = require("path");
const Fs = require("./file-ops");
const xaa = require("./xaa");

async function linkFile(srcFp, destFp, srcStat) {
  try {
    return await Fs.link(srcFp, destFp);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (!srcStat) throw e;
    const destStat = await Fs.stat(destFp);
    if (srcStat.ino !== destStat.ino) {
      await Fs.unlink(destFp);
      return await linkFile(srcFp, destFp);
    }
  }

  return undefined;
}

async function prepDestDir(dest) {
  const statDest = await xaa.try(() => Fs.lstat(dest));

  const destFiles = {};

  if (!statDest) {
    await Fs.mkdir(dest);
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

async function link(src, dest, filter = []) {
  const files = await Fs.readdir(src);

  const destFiles = await prepDestDir(dest);

  for (const file of files) {
    destFiles[file] = true;
    if (filter.indexOf(file) >= 0) continue;
    const srcFp = Path.join(src, file);
    const destFp = Path.join(dest, file);
    const stat = await Fs.lstat(srcFp);
    if (stat.isSymbolicLink()) {
      // TODO
    } else if (stat.isDirectory()) {
      await link(srcFp, destFp);
    } else if (stat.isFile()) {
      await linkFile(srcFp, destFp, stat);
    } else {
      throw new Error(`Hard link src stat type unknown: ${srcFp}`);
    }
  }

  // any file exist in dest but not in src are removed
  await cleanExtraDest(dest, destFiles);
}

module.exports = {
  link
};
