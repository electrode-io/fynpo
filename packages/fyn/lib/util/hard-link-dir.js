"use strict";

/*
 * clone another directory by:
 * - Creating the same directories
 * - Hard link physical files
 * - Transfer symlinks (ensure the same symlink name exist but with target adjusted)
 */

const Path = require("path");
const assert = require("assert");
const Fs = require("./file-ops");
const xaa = require("./xaa");

async function link(src, dest) {
  const files = await Fs.readdir(src);

  const statDest = await xaa.try(() => Fs.lstat(dest));

  if (!statDest) {
    await Fs.mkdir(dest);
  } else {
    assert(statDest.isDirectory(), `Hard link dest exist but is not dir: ${dest}`);
  }

  for (const file of files) {
    const srcFp = Path.join(src, file);
    const destFp = Path.join(dest, file);
    const stat = await Fs.lstat(srcFp);
    if (stat.isSymbolicLink()) {
      //
    } else if (stat.isDirectory()) {
      await Fs.mkdir(destFp);
      await link(srcFp, destFp);
    } else if (stat.isFile()) {
      await Fs.link(srcFp, destFp);
    } else {
      throw new Error(`Hard link src stat type unknown: ${srcFp}`);
    }
  }
}

module.exports = {
  link
};
