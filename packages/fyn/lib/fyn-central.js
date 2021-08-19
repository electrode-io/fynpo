"use strict";

/* eslint-disable no-magic-numbers, max-params, max-statements, no-empty */

const Path = require("path");
const Fs = require("./util/file-ops");
const ssri = require("ssri");
const Tar = require("tar");
const Promise = require("bluebird");
const { missPipe } = require("./util/fyntil");
const { linkFile } = require("./util/hard-link-dir");
const logger = require("./logger");
const { AggregateError } = require("@jchip/error");

/**
 * convert a directory tree structure to a flatten one like:
 * ```
 * {
 *  dirs: [
 *    "/dir1"
 *  ],
 *  files: [
 *    "/file1",
 *    "/dir1/file1"
 *  ]
 * }
 * ```
 * @param {*} tree - the dir tree
 * @param {*} output - output object
 * @param {*} baseDir - base dir path
 * @returns flatten dir list
 */
function flattenTree(tree, output, baseDir) {
  const dirs = Object.keys(tree);

  for (const dir of dirs) {
    if (dir === "/") continue;
    const fdir = Path.join(baseDir, dir);
    output.dirs.push(fdir);
    flattenTree(tree[dir], output, fdir);
  }

  const files = Object.keys(tree["/"]);
  for (const file of files) {
    output.files.push(Path.join(baseDir, file));
  }

  return output;
}

/**
 * create and maintain the fyn central storage
 */
class FynCentral {
  constructor({ centralDir = ".fyn/_central-storage" }) {
    this._centralDir = Path.resolve(centralDir);
    this._map = new Map();
  }

  _analyze(integrity) {
    const sri = ssri.parse(integrity, { single: true });

    const algorithm = sri.algorithm;
    const hex = sri.hexDigest();

    const segLen = 2;
    const contentPath = Path.join(
      ...[this._centralDir, algorithm].concat(
        hex.substr(0, segLen),
        hex.substr(segLen, segLen),
        hex.substr(segLen * 2)
      )
    );

    return { algorithm, contentPath, hex };
  }

  async _loadTree(integrity, info, noSet) {
    if (!info) {
      if (this._map.has(integrity)) {
        info = this._map.get(integrity);
        noSet = true;
      } else {
        info = this._analyze(integrity);
        info.tree = false;
      }
    }

    try {
      const stat = await Fs.stat(info.contentPath);
      info.exist = true;
      if (stat.isDirectory()) {
        const treeFile = Path.join(info.contentPath, "tree.json");
        const tree = await Fs.readFile(treeFile)
          .then(JSON.parse)
          .catch(err => {
            throw new Error(`fyn-central: reading ${treeFile} - ${err.message}`);
          });
        info.tree = tree;
        if (!noSet) this._map.set(integrity, info);
      }
      return info;
    } catch (err) {
      return info;
    }
  }

  async has(integrity) {
    if (this._map.has(integrity)) return true;
    const info = await this._loadTree(integrity);
    return Boolean(info.tree);
  }

  async get(integrity) {
    return await this.getInfo(integrity).contentPath;
  }

  async getInfo(integrity) {
    if (this._map.has(integrity)) return this._map.get(integrity);
    const info = await this._loadTree(integrity);
    if (!info.tree) {
      throw new Error(`fyn-central can't get package for integrity ${integrity}`);
    }
    return info;
  }

  async replicate(integrity, destDir) {
    try {
      const info = await this.getInfo(integrity);

      const list = flattenTree(info.tree, { dirs: [], files: [] }, "");

      for (const dir of list.dirs) {
        await Fs.$.mkdirp(Path.join(destDir, dir));
      }

      await Promise.map(
        list.files,
        file => linkFile(Path.join(info.contentPath, "package", file), Path.join(destDir, file)),
        { concurrency: 5 }
      );
    } catch (err) {
      const msg = `fyn-central can't replicate package at ${destDir} for integrity ${integrity}`;
      throw new AggregateError([err], msg);
    }
  }

  _untarStream(tarStream, targetDir) {
    const dirTree = { "/": {} };

    const strip = 1;

    const untarStream = Tar.x({
      strip,
      strict: true,
      C: targetDir,
      onentry: entry => {
        const parts = entry.path.split(/\/|\\/);
        const isDir = entry.type === "Directory";
        const dirs = parts.slice(strip, isDir ? parts.length : parts.length - 1);

        const wtree = dirs.reduce((wt, dir) => {
          return wt[dir] || (wt[dir] = { "/": {} });
        }, dirTree);

        if (isDir) return;

        const fname = parts[parts.length - 1];
        if (fname) {
          const m = Math.round((entry.mtime ? entry.mtime.getTime() : Date.now()) / 1000);
          wtree["/"][fname] = {
            z: entry.size,
            m,
            $: entry.header.cksumValid && entry.header.cksum
          };
        }
      }
    });

    return missPipe(tarStream, untarStream).then(() => dirTree);
  }

  async _acquireTmpLock(info) {
    const tmpLock = `${info.contentPath}.lock`;

    try {
      await Fs.$.mkdirp(Path.dirname(info.contentPath));
      await Fs.$.acquireLock(tmpLock, {
        wait: 5 * 60 * 1000,
        pollPeriod: 500,
        stale: 5 * 60 * 1000
      });
    } catch (err) {
      logger.error("fyn-central - unable to acquire tmp lock", tmpLock);
      const msg = err.message && err.message.replace(tmpLock, "<lockfile>");
      throw new Error(`Unable to acquire fyn-central tmp lock ${tmpLock} - ${msg}`);
    }

    return tmpLock;
  }

  async _storeTarStream(info, stream) {
    const tmp = `${info.contentPath}.tmp`;

    await Fs.$.rimraf(tmp); // in case there was any remnant left from an interrupted install
    const targetDir = Path.join(tmp, "package");
    await Fs.$.mkdirp(targetDir);
    if (typeof stream === "function") {
      stream = stream();
    }
    if (stream.then) {
      stream = await stream;
    }
    // TODO: user could break during untar and cause corruptted module
    info.tree = await this._untarStream(stream, targetDir, info);
    await Fs.writeFile(Path.join(tmp, "tree.json"), JSON.stringify(info.tree));

    await Fs.rename(tmp, info.contentPath);
    info.exist = true;
  }

  async storeTarStream(pkgId, integrity, stream) {
    let tmpLock = false;

    try {
      let info = await this._loadTree(integrity);

      if (info.exist) {
        logger.debug("fyn-central storeTarStream: already exist", info.contentPath);
        if (!info.tree) {
          logger.error(`fyn-central exist package missing tree.json`);
        }
      } else {
        tmpLock = await this._acquireTmpLock(info);
        info = await this._loadTree(integrity, info, true);

        if (info.exist) {
          logger.debug("fyn-central storeTarStream: found after lock acquired", info.contentPath);
          if (!info.tree) {
            const msg = `fyn-central content exist but no tree.json ${info.contentPath}`;
            logger.error(msg);
            throw new Error(msg);
          }
        } else {
          logger.debug("storing tar to central store", pkgId, integrity);
          await this._storeTarStream(info, stream);
          stream = undefined;
          this._map.set(integrity, info);
          logger.debug("fyn-central storeTarStream: stored", pkgId, info.contentPath);
        }
      }
    } finally {
      if (stream && stream.destroy !== undefined) {
        stream.destroy();
      }

      if (tmpLock) {
        await Fs.$.releaseLock(tmpLock);
      }
    }
  }
}

module.exports = FynCentral;
