"use strict";

/* eslint-disable max-params, max-statements, complexity */

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
const logger = require("../logger");
const { SourceMapGenerator } = require("source-map");
const ci = require("ci-info");

async function linkFile(srcFp, destFp, srcStat) {
  try {
    return await Fs.link(srcFp, destFp);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;

    if (srcStat === undefined) {
      srcStat = await xaa.try(() => Fs.stat(srcFp));
    }

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
      logger.debug(`removing extra local link file ${k}`);
      await Fs.$.rimraf(Path.join(dest, k));
    }
  }
}

const FILES = Symbol("files");

async function generatePackTree(path) {
  const files = await npmPacklist({
    path
  });

  logger.debug(
    `local package linking - pack tree returned ${files.length} files to link`,
    JSON.stringify(files, null, 2)
  );

  if (files.length > 1000) {
    logger.warn(
      `Local linking package at ${path} has more than ${files.length} files.
  >>> This is unusual, please check package .npmignore or 'files' in package.json <<<`
    );
  }

  const fmap = { [FILES]: [] };

  files.sort().forEach(filePath => {
    const dir = Path.dirname(filePath);
    if (dir === ".") {
      fmap[FILES].push(filePath);
      return;
    }

    let dmap = fmap;
    // npm pack list always generate file path with /
    dir.split("/").forEach(d => {
      if (!dmap[d]) {
        dmap[d] = { [FILES]: [] };
      }
      dmap = dmap[d];
    });

    dmap[FILES].push(Path.basename(filePath));
  });

  return fmap;
}

const FYN_SOURCE_MAP_SIG = "//# fynSourceMap";
const SOURCE_MAP_URL = "//# sourceMappingURL=";

/**
 * search for the last sourceMappingURL from a source content
 *
 * @param {*} content
 * @returns
 */
function getSourceMapURL(content) {
  const regex = /(?:\/\/[@#][\s]*sourceMappingURL=([^\s'"]+)[\s]*$)|(?:\/\*[@#][\s]*sourceMappingURL=([^\s*'"]+)[\s]*(?:\*\/)[\s]*$)/gm;
  let match;
  let lastMatch;

  // search for the last occurrence of sourceMappingURL
  while ((match = regex.exec(content))) {
    lastMatch = match;
  }

  return lastMatch && lastMatch[1];
}

/**
 * process or generate source map back to original file
 *
 * @param {*} param0
 */
async function handleSourceMap({ file, destFiles, src, dest, srcFp, destFp, genSourceMaps }) {
  const ext = !ci.isCI && Path.extname(file);

  // native plain js or mjs files should map back to the original local files
  // and it may or may not have source map file
  if (ext !== ".js" && ext !== ".mjs") {
    return;
  }

  const content = await Fs.readFile(srcFp, "utf-8");
  const fynMapped = content.includes(FYN_SOURCE_MAP_SIG);
  const hasMapUrl = content.includes(SOURCE_MAP_URL);
  if (!fynMapped && hasMapUrl) {
    const sourceMapFile = getSourceMapURL(content);

    if (Path.isAbsolute(sourceMapFile)) {
      logger.info(`File ${srcFp} sourcemap ${sourceMapFile} is full path - can't rewrite it`);
      return;
    }

    const srcMapFp = Path.join(src, sourceMapFile);
    const mapContent = await xaa.try(() => Fs.readFile(srcMapFp, "utf-8"));

    if (!mapContent) {
      logger.debug(`Sourcemap of file not found: ${srcFp} - ${sourceMapFile}`);
      return;
    }

    // file has source map, need to update map file to point back to original location for source
    const mapData = JSON.parse(mapContent);
    const { sourceRoot = "" } = mapData;
    delete mapData.sourceRoot;
    mapData.sources = mapData.sources.map(s => {
      const source1 = sourceRoot + s;
      const source2 = Path.isAbsolute(source1) ? source1 : Path.join(src, source1);
      const relPath = Path.relative(dest, source2);
      logger.debug(`Rewriting map file source to ${relPath} from ${dest} to ${source2}`);
      return relPath;
    });

    const destMapFp = Path.join(dest, sourceMapFile);
    await xaa.try(
      () => Fs.writeFile(destMapFp, JSON.stringify(mapData)),
      () => {
        logger.info(`Failed to save rewritten source map file ${destMapFp}`);
      }
    );

    // TODO: what if sourceMapFile is not next to the source file?
    destFiles[sourceMapFile] = true;

    return;
  }

  if (!genSourceMaps) {
    return;
  }

  // file is marked for fynMapped or it doesn't have source map so fyn needs to generate one for it
  if (fynMapped || !hasMapUrl) {
    const fileMap = `${file}.fyn.map`;
    const destMapFp = Path.join(dest, fileMap);

    logger.debug(`Generating map file for ${srcFp} to ${destFp}`);
    const allLines = content.split("\n");
    const count = allLines.length;
    const sourceMap = new SourceMapGenerator({ file });
    const source = Path.relative(dest, srcFp);
    for (let line = 1; line <= count; line++) {
      const length = allLines[line - 1].length;
      // source map format doesn't have a way to say just 1-1 map back to source
      // so we are mapping every line and every column directly, it's a waste, but
      // the only way to achieve this.
      for (let column = 0; column < length; column++) {
        sourceMap.addMapping({
          generated: { line, column },
          source,
          original: { line, column }
        });
      }
    }
    await Fs.writeFile(destMapFp, sourceMap.toString());
    destFiles[fileMap] = true;
    if (!hasMapUrl) {
      const sep = content.endsWith("\n") ? "" : "\n";
      const fynMapStr = fynMapped ? "" : `${FYN_SOURCE_MAP_SIG}\n`;
      await Fs.writeFile(destFp, `${content}${sep}${fynMapStr}${SOURCE_MAP_URL}${fileMap}\n`);
    }
  }
}

/**
 * Link tree of files generated from npm pack
 *
 * @param {*} tree
 * @param {*} src
 * @param {*} dest
 * @param {*} sym1
 */
async function linkPackTree({ tree, src, dest, sym1, genSourceMaps }) {
  const files = tree[FILES];

  const destFiles = await prepDestDir(dest);

  //
  // create hardlinks to files
  //
  for (const file of files) {
    // In non-CI mode, skip linking source map file by matching for extensions like .js.map
    // because we rewrite their sources and copy them already
    if (!ci.isCI && file.match(/.+\..+\.map$/)) {
      continue;
    }

    destFiles[file] = true;
    const srcFp = Path.join(src, file);
    const destFp = Path.join(dest, file);
    await linkFile(srcFp, destFp);
    await handleSourceMap({ file, destFiles, src, dest, srcFp, destFp, genSourceMaps });
  }

  //
  // handle sub directories
  //
  const dirs = Object.keys(tree).sort();
  for (const dir of dirs) {
    // in case the tree is generated without top level dir by itself
    // tree is generated to always use / for path separator
    destFiles[dir.split("/")[0]] = true;
    const srcFp = Path.join(src, dir);
    const destFp = Path.join(dest, dir);
    if (!sym1) {
      // recursively duplicate sub dirs with hardlinks
      await linkPackTree({ tree: tree[dir], src: srcFp, dest: destFp, genSourceMaps });
    } else {
      // make symlink to directories in the top level
      await fynTil.symlinkDir(destFp, srcFp);
    }
  }

  logger.debug(`linkPackTree src: ${src} dest: ${dest} - destFiles ${JSON.stringify(destFiles)}`);

  // any file exist in dest but not in src are removed
  await cleanExtraDest(dest, destFiles);
}

async function link(src, dest, { genSourceMaps = true } = {}) {
  const tree = await generatePackTree(src);

  return await linkPackTree({ tree, src, dest, genSourceMaps });
}

async function linkSym1(src, dest) {
  const tree = await generatePackTree(src);

  return await linkPackTree({ tree, src, dest, sym1: true });
}

module.exports = {
  link,
  linkFile,
  linkSym1
};
