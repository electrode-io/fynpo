"use strict";

/* eslint-disable no-magic-numbers, max-params, max-statements, no-empty */

const Path = require("path");
const Fs = require("./util/file-ops");
const ssri = require("ssri");
const Tar = require("tar");
const Promise = require("bluebird");
const { linkFile } = require("./util/hard-link-dir");
const logger = require("./logger");
const lockfile = require("lockfile");
const acquireLock = Promise.promisify(lockfile.lock, { context: lockfile });
const releaseLock = Promise.promisify(lockfile.unlock, { context: lockfile });

const isWin32 = process.platform === "win32";

const RENAME_RETRIES = isWin32 ? 10 : 0;

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

function retry(func, checks, tries, wait) {
  return Promise.try(func).catch(err => {
    if (tries <= 0) throw err;
    tries--;
    return Promise.try(
      () => (Array.isArray(checks) ? checks.indexOf(err.code) >= 0 : checks(err))
    ).then(canRetry => {
      if (!canRetry) throw err;
      return Promise.delay(wait).then(() => retry(func, checks, tries, wait));
    });
  });
}

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
      throw new Error("fyn-central can't get package for integrity", integrity);
    }
    return info;
  }

  async replicate(integrity, destDir) {
    const info = await this.getInfo(integrity);

    const list = flattenTree(info.tree, { dirs: [], files: [] }, "");

    await Promise.map(list.dirs, dir => Fs.$.mkdirp(Path.join(destDir, dir)), { concurrency: 10 });

    await Promise.map(
      list.files,
      file => linkFile(Path.join(info.contentPath, "package", file), Path.join(destDir, file)),
      { concurrency: 10 }
    );
  }

  _untarStream(tarStream, targetDir) {
    const dirTree = { "/": {} };
    const strip = 1;
    return new Promise((resolve, reject) => {
      const stream = tarStream.pipe(
        Tar.x({
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
        })
      );
      stream.on("error", reject);
      stream.on("close", () => resolve(dirTree));
    });
  }

  async _acquireTmpLock(info) {
    const tmpLock = `${info.contentPath}.lock`;

    try {
      await Fs.$.mkdirp(Path.dirname(info.contentPath));
      await acquireLock(tmpLock, { wait: 15 * 1000, pollPeriod: 100, stale: 300 * 1000 });
    } catch (err) {
      logger.error("fyn-central storeTarStream - unable to acquire", tmpLock);
      const msg = err.message && err.message.replace(tmpLock, "<lockfile>");
      throw new Error(`Unable to acquire ${tmpLock} - ${msg}`);
    }

    return tmpLock;
  }

  async _storeTarStream(info, stream) {
    const tmp = `${info.contentPath}.tmp`;

    await Fs.$.mkdirp(tmp);
    const targetDir = Path.join(tmp, "package");
    await Fs.$.mkdirp(targetDir);
    info.tree = await this._untarStream(
      typeof stream === "function" ? stream() : stream,
      targetDir,
      info
    );
    await Fs.writeFile(Path.join(tmp, "tree.json"), JSON.stringify(info.tree));

    await retry(() => Fs.rename(tmp, info.contentPath), ["EACCESS", "EPERM"], RENAME_RETRIES, 100);
  }

  async storeTarStream(integrity, stream) {
    let tmpLock = false;

    try {
      let info = await this._loadTree(integrity);

      if (info.tree) {
        logger.debug("fyn-central storeTarStream: already exist", info.contentPath);
      } else {
        tmpLock = await this._acquireTmpLock(info);
        info = await this._loadTree(integrity, info, true);

        if (info.tree) {
          logger.debug("fyn-central storeTarStream: found after lock acquired", info.contentPath);
        } else {
          await this._storeTarStream(info, stream);
          stream = undefined;
          this._map.set(integrity, info);
        }
      }
    } finally {
      if (stream && stream.destroy !== undefined) {
        stream.destroy();
      }

      if (tmpLock) {
        await releaseLock(tmpLock);
      }
    }
  }
}

module.exports = FynCentral;
