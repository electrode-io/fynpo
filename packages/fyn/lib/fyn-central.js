"use strict";

/* eslint-disable no-magic-numbers, max-params, max-statements, no-empty */

const Path = require("path");
const Fs = require("./util/file-ops");
const ssri = require("ssri");
const Tar = require("tar");
const Promise = require("bluebird");
const { linkFile } = require("./util/hard-link-dir");
const logger = require("./logger");

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
    info = info || this._analyze(integrity);
    info.tree = false;
    try {
      const stat = await Fs.stat(info.contentPath);
      if (stat.isDirectory()) {
        const tree = await Fs.readFile(Path.join(info.contentPath, "tree.json")).then(JSON.parse);
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
    const info = this._loadTree(integrity);
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

  async _waitForAnotherStoreTar(tmp) {
    // another process already processing
    // wait up to 1 minute for it to finish
    try {
      logger.debug("fyn-central storeTarStream: wait for tmp", tmp);
      return await retry(
        async () => {
          if (await Fs.exists(tmp)) {
            throw new Error(`still waiting ${tmp}`);
          }
        },
        () => true,
        10 * 60,
        100
      );
    } catch (err) {
      logger.error("fyn-central storeTarStream: tmp didn't complete after 1 min", tmp);
      throw err;
    }
  }

  async storeTarStream(integrity, stream) {
    let info = await this._loadTree(integrity);
    if (info.tree) {
      logger.debug("fyn-central storeTarStream: already exist", info.contentPath);
      stream.destroy();
      return undefined;
    }

    const tmp = `${info.contentPath}.tmp`;
    await Fs.$.mkdirp(Path.dirname(tmp));

    try {
      await Fs.mkdir(tmp);
    } catch (err) {
      stream.destroy();
      if (err.code !== "EEXIST") throw err;
      return await this._waitForAnotherStoreTar(tmp);
    }

    info = await this._loadTree(integrity, info);

    if (info.tree) {
      stream.destroy();
      logger.warn("fyn-central storeTarStream: tree exist after tmp created", tmp);
      return await Fs.$.rimraf(tmp);
    }

    const targetDir = Path.join(tmp, "package");
    await Fs.$.mkdirp(targetDir);
    const tree = await this._untarStream(stream, targetDir, info);

    await Fs.writeFile(Path.join(tmp, "tree.json"), JSON.stringify(tree));

    info.tree = tree;

    this._map.set(integrity, info);

    await retry(() => Fs.rename(tmp, info.contentPath), ["EACCESS", "EPERM"], RENAME_RETRIES, 100);
  }
}

module.exports = FynCentral;
