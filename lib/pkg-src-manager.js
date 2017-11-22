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
const Url = require("url");
const access = Promise.promisify(Fs.access);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);

class PkgSrcManager {
  constructor(options) {
    this._options = _.defaults({}, options, {
      registry: "",
      fynCacheDir: ""
    });
    this._meta = {};
    this._cacheDir = this._options.fynCacheDir;
    mkdirp.sync(this._cacheDir);
    this._inflights = {
      meta: {},
      tarball: {}
    };
    this._registry =
      this._options.registry &&
      _.pick(Url.parse(this._options.registry), ["protocol", "auth", "host", "port", "hostname"]);
  }

  makePkgCacheDir(pkgName) {
    const pkgCacheDir = Path.join(this._cacheDir, pkgName);
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

    if (this._inflights.meta[pkgName]) {
      return this._inflights.meta[pkgName];
    }

    const metaUrl = this.formatMetaUrl(item);

    const pkgCacheDir = this.makePkgCacheDir(pkgName);
    const cacheMetaFile = `${pkgCacheDir}/meta.yaml`;

    const doRequest = cached => {
      const headers = {};
      if (cached.etag) {
        headers["if-none-match"] = `"${cached.etag}"`;
      }
      const promise = request({
        uri: metaUrl,
        headers,
        resolveWithFullResponse: true
      })
        .then(response => {
          const body = response.body;
          const etag = response.headers.etag;
          logger.log(`fetched ${pkgName} meta data`);
          const meta = (this._meta[pkgName] = JSON.parse(body));
          meta.etag = etag;
          return writeFile(cacheMetaFile, Yaml.safeDump(this._meta[pkgName]))
            .thenReturn(meta)
            .catch(err => {
              logger.log("write meta cache fail", cacheMetaFile);
              throw err;
            });
        })
        .catch(err => {
          if (err.statusCode !== undefined) {
            if (err.statusCode === 304) {
              this._meta[pkgName] = cached;
              return cached;
            }
            logger.log("meta fetch failed with status", err.statusCode);
          }

          throw err;
        });

      return promise;
    };

    const promise = (this._inflights.meta[pkgName] = access(cacheMetaFile)
      .then(() => {
        return readFile(cacheMetaFile).then(data => Yaml.load(data.toString()));
      })
      .then(doRequest)
      .catch(() => {
        return doRequest({});
      })
      .finally(() => {
        delete this._inflights.meta[pkgName];
      }));

    return promise;
  }

  formatTarballUrl(item) {
    const tgzFile = `${item.name}-${item.version}.tgz`;

    const tarball = Url.parse(_.get(item, "dist.tarball", ""));

    const result = Object.assign(
      _.defaults(tarball, { pathname: `${item.name}/-/${tgzFile}` }),
      this._registry
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
        if (this._inflights.tarball[fullTgzFile]) {
          return this._inflights.tarball[fullTgzFile];
        }
        const stream = Fs.createWriteStream(fullTgzFile);
        const fetchPromise = new Promise((resolve, reject) => {
          request(pkgUrl)
            .on("response", resolve)
            .on("error", reject)
            .pipe(stream);
        })
          .then(resp => {
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
                  logger.log(
                    `fetch ${pkgName} result ${resp.statusCode} time: ${elapse / 1000}sec`
                  );
                  resolve({ fullTgzFile });
                };
                stream.on("finish", () => (finish = setTimeout(close, 1000)));
                stream.on("error", reject);
                stream.on("close", close);
              });
            }
            logger.log(`fetchTarball: ${pkgName} response error`, resp.statusCode);
            return false;
          })
          .finally(() => {
            delete this._inflights.tarball[fullTgzFile];
          });

        this._inflights.tarball[fullTgzFile] = fetchPromise;

        return fetchPromise;
      });

    return {
      then: (r, e) => promise.then(r, e),
      catch: e => promise.catch(e),
      tap: f => promise.tap(f),
      promise,
      pkgUrl,
      startTime,
      fullTgzFile
    };
  }
}

module.exports = PkgSrcManager;
