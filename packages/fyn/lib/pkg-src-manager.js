"use strict";

//
// Manages all sources that package data could come from.
// - local cache
// - git repo
// - local dir
// - npm registry
//

/* eslint-disable no-magic-numbers */

const request = require("request-promise");
const Promise = require("bluebird");
const Fs = require("fs");
const _ = require("lodash");
// const Semver = require("semver");
const Yaml = require("js-yaml");
const logger = require("./logger");
const mkdirp = require("mkdirp");
const Path = require("path");
const access = Promise.promisify(Fs.access);
const Url = require("url");

class PkgSrcManager {
  constructor(options) {
    this._options = _.defaults({}, options, { fynCacheDir: "" });
    this._meta = {};
    mkdirp.sync(this._options.fynCacheDir, ".cache");
  }

  makePkgCacheDir(pkgName) {
    const pkgCacheDir = Path.resolve(".cache", pkgName);
    mkdirp.sync(pkgCacheDir);
    return pkgCacheDir;
  }

  // TODO
  // _checkCacheMeta(pkgName) {}

  formatMetaUrl(item) {
    const reg = Url.parse(this._options.registry);
    reg.pathname = Path.posix.join(reg.pathname, encodeURIComponent(item.name));
    return Url.format(reg);
  }

  fetchMeta(item) {
    const pkgName = item.name;

    if (this._meta[pkgName]) {
      return Promise.resolve(this._meta[pkgName]);
    }

    const metaUrl = this.formatMetaUrl(item);
    logger.log("fetching meta", metaUrl);

    return request(metaUrl).then(body => {
      logger.log(`fetch ${pkgName} meta data`);
      const meta = (this._meta[pkgName] = JSON.parse(body));
      const pkgCacheDir = this.makePkgCacheDir(pkgName);
      Fs.writeFileSync(`${pkgCacheDir}/meta.yaml`, Yaml.safeDump(this._meta[pkgName]));
      return meta;
    });
  }

  formatTarballUrl(item) {
    const tgzFile = `${item.name}-${item.version}.tgz`;

    const tarball = Url.parse(_.get(item, "dist.tarball", ""));
    const registry = this._options.registry
      ? _.pick(Url.parse(this._options.registry), ["protocol", "auth", "host", "port", "hostname"])
      : {};

    const result = Object.assign(
      _.defaults(tarball, { pathname: `${item.name}/-/${tgzFile}` }),
      registry
    );

    return Url.format(result);
  }

  fetchTarball(item) {
    const startTime = Date.now();
    const pkgName = item.name;
    const pkgCacheDir = this.makePkgCacheDir(pkgName);
    const tgzFile = `pkg-${item.version}.tgz`;
    const fullTgzFile = Path.join(pkgCacheDir, tgzFile);

    const pkgUrl = this.formatTarballUrl(item);

    const promise = access(fullTgzFile)
      .then(() => ({ fullTgzFile }))
      .catch(err => {
        if (err.code !== "ENOENT") throw err;
        const stream = Fs.createWriteStream(fullTgzFile);
        return new Promise((resolve, reject) => {
          request(pkgUrl)
            .on("response", resolve)
            .on("error", reject)
            .pipe(stream);
        }).then(resp => {
          // logger.log("response code", resp.statusCode);
          if (resp.statusCode === 200) {
            return new Promise((resolve, reject) => {
              let closed;
              let finish;
              const close = () => {
                clearTimeout(finish);
                if (closed) return;
                closed = true;
                const elapse = Date.now() - startTime;
                logger.log(`fetch ${pkgName} result ${resp.statusCode} time: ${elapse / 1000}sec`);
                resolve({ fullTgzFile });
              };
              stream.on("finish", () => (finish = setTimeout(close, 1000)));
              stream.on("error", reject);
              stream.on("close", close);
            });
          }
          logger.log(`fetch ${pkgName} response error`, resp.statusCode);
          return false;
        });
      });

    return { promise, pkgUrl, startTime, fullTgzFile };
  }
}

module.exports = PkgSrcManager;
