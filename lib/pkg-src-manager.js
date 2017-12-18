"use strict";

//
// Manages all sources that package data could come from.
// - local cache
// - git repo
// - local dir
// - npm registry
//

/* eslint-disable no-magic-numbers */

const request = require("request");
const requestP = require("request-promise");
const Promise = require("bluebird");
const Fs = require("fs");
const _ = require("lodash");
const chalk = require("chalk");
// const Semver = require("semver");
const logger = require("./logger");
const mkdirp = require("mkdirp");
const Path = require("path");
const Url = require("url");
const access = Promise.promisify(Fs.access);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);
const rename = Promise.promisify(Fs.rename);
const Inflight = require("./util/inflight");
const { FETCH_META, FETCH_PACKAGE, NETWORK_ERROR } = require("./log-items");

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
      meta: new Inflight(),
      tarball: new Inflight()
    };
    this._fyn = options.fyn;
    this._registry = this._options.registry && Url.parse(this._options.registry);
    this._tgzRegistry = _.pick(this._registry, ["protocol", "auth", "host", "port", "hostname"]);
    this._registryHost = this._registry.host;
    this._localMeta = {};
  }

  makePkgCacheDir(pkgName) {
    const pkgCacheDir = Path.join(this._cacheDir, pkgName);
    mkdirp.sync(pkgCacheDir);
    return pkgCacheDir;
  }

  /* eslint-disable max-statements */
  fetchLocalItem(item) {
    const semver = item.semver;
    let localPath;

    if (semver.startsWith("file:")) {
      localPath = semver.substr(5);
    } else if (semver.startsWith("/") || semver.startsWith("./") || semver.startsWith("../")) {
      localPath = semver;
    } else if (semver.startsWith("~/")) {
      localPath = Path.join(process.env.HOME, semver.substr(1));
    }

    if (localPath) {
      let fullPath;
      if (!Path.isAbsolute(localPath)) {
        if (item.parent && item.parent.local) {
          fullPath = Path.join(item.parent.fullPath, localPath);
        } else {
          fullPath = Path.resolve(localPath);
        }
      } else {
        fullPath = localPath;
      }
      item.local = true;
      item.fullPath = fullPath;
      const pkgJsonFile = Path.join(fullPath, "package.json");

      if (this._localMeta[fullPath]) return Promise.resolve(this._localMeta[fullPath]);

      return readFile(pkgJsonFile).then(raw => {
        const str = raw.toString();
        const json = JSON.parse(str);
        json.dist = {
          semver,
          localPath,
          fullPath,
          str
        };
        this._localMeta[fullPath] = {
          local: true,
          json,
          name: json.name,
          versions: {
            [json.version]: json
          },
          "dist-tags": {
            latest: json.version
          }
        };
        item.semver = json.version;

        return this._localMeta[fullPath];
      });
    }

    return false;
  }

  // TODO
  // _checkCacheMeta(pkgName) {}

  formatMetaUrl(item) {
    const reg = Object.assign({}, this._registry);
    reg.pathname = Path.posix.join(reg.pathname, encodeURIComponent(item.name));
    return Url.format(reg);
  }

  fetchMeta(item) {
    const local = this.fetchLocalItem(item);
    if (local) return local;

    const pkgName = item.name;

    if (this._meta[pkgName]) {
      return Promise.resolve(this._meta[pkgName]);
    }

    const inflight = this._inflights.meta.get(pkgName);
    if (inflight) {
      return inflight;
    }

    const metaUrl = this.formatMetaUrl(item);

    const pkgCacheDir = this.makePkgCacheDir(pkgName);
    const cacheMetaFile = `${pkgCacheDir}/meta.json`;

    const updateItem = status => {
      status = chalk.cyan(`${status}`);
      const time = chalk.magenta(`${this._inflights.meta.time(pkgName) / 1000}`);
      logger.updateItem(FETCH_META, `${status} ${time}secs ${chalk.red.bgGreen(pkgName)}`);
    };

    const doRequest = cached => {
      const fynFo = cached.fynFo || {};
      const regInfo = fynFo[this._registryHost] || {};
      fynFo[this._registryHost] = regInfo;
      const headers = {};
      if (regInfo.etag) {
        headers["if-none-match"] = regInfo.etag;
      } else if (regInfo.lastMod) {
        headers["if-modified-since"] = regInfo.lastMod;
      }
      const promise = requestP({
        uri: metaUrl,
        headers,
        resolveWithFullResponse: true
      })
        .then(response => {
          const body = response.body;
          const headers = response.headers;
          const meta = JSON.parse(body);
          if (headers.etag) {
            regInfo.etag = headers.etag;
          } else if (headers["last-modified"]) {
            regInfo.lastMod = headers["last-modified"];
          }
          fynFo.updated = Date.now();
          meta.fynFo = fynFo;
          updateItem(response.statusCode);
          return writeFile(cacheMetaFile, JSON.stringify(meta, null, 2))
            .thenReturn(meta)
            .catch(err => {
              logger.error("write meta cache fail", cacheMetaFile);
            });
        })
        .catch(err => {
          if (err.statusCode !== undefined) {
            if (err.statusCode === 304) {
              updateItem(err.statusCode);
              return cached;
            }
            logger.error(chalk.red(`meta fetch ${pkgName} failed with status ${err.statusCode}`));
          } else {
            logger.addItem({
              name: NETWORK_ERROR,
              display: "network error fetching meta",
              color: "red"
            });
            logger.updateItem(NETWORK_ERROR, err.message);
          }
        });

      return promise;
    };

    const promise = access(cacheMetaFile)
      .then(() => {
        return readFile(cacheMetaFile).then(data => JSON.parse(data.toString()));
      })
      .then(cached => {
        return this._fyn.localOnly ? cached : doRequest(cached);
      })
      .catch(() => {
        return doRequest({});
      })
      .then(meta => (this._meta[pkgName] = meta))
      .finally(() => {
        this._inflights.meta.remove(pkgName);
      });

    return this._inflights.meta.add(pkgName, promise);
  }

  formatTarballUrl(item) {
    const tgzFile = `${item.name}-${item.version}.tgz`;

    const tarball = Url.parse(_.get(item, "dist.tarball", ""));

    const result = Object.assign(
      _.defaults(tarball, { pathname: `${item.name}/-/${tgzFile}` }),
      this._tgzRegistry
    );

    return Url.format(result);
  }

  fetchTarball(item) {
    const startTime = Date.now();
    const pkgName = item.name;
    const pkgCacheDir = this.makePkgCacheDir(pkgName);
    const tmpFile = `tmp-${item.version}.tgz`;
    const tgzFile = `pkg-${item.version}.tgz`;
    const fullTmpFile = Path.join(pkgCacheDir, tmpFile);
    const fullTgzFile = Path.join(pkgCacheDir, tgzFile);

    const pkgUrl = this.formatTarballUrl(item);

    const promise = access(fullTgzFile)
      .then(() => ({ fullTgzFile }))
      .catch(err => {
        if (err.code !== "ENOENT") throw err;
        const inflight = this._inflights.tarball.get(fullTgzFile);
        if (inflight) {
          return inflight;
        }
        const stream = Fs.createWriteStream(fullTmpFile);
        const fetchPromise = new Promise((resolve, reject) => {
          request(pkgUrl)
            .on("response", resolve)
            .on("error", reject)
            .pipe(stream);
        })
          .then(resp => {
            logger.debug("fetchTarball response code", resp.statusCode);
            if (resp.statusCode === 200) {
              return new Promise((resolve, reject) => {
                let closed;
                let finish;
                const close = () => {
                  clearTimeout(finish);
                  if (closed) return;
                  closed = true;
                  const time = chalk.magenta(`${(Date.now() - startTime) / 1000}`);
                  logger.updateItem(
                    FETCH_PACKAGE,
                    `${chalk.red.bgGreen(pkgName)} result ${resp.statusCode} ${time}secs`
                  );
                  resolve();
                };
                stream.on("finish", () => (finish = setTimeout(close, 1000)));
                stream.on("error", reject);
                stream.on("close", close);
              })
                .then(() => rename(fullTmpFile, fullTgzFile))
                .return({ fullTgzFile });
            }
            logger.error(`fetchTarball: ${pkgUrl} response error`, resp.statusCode);
            return false;
          })
          .catch(err => {
            logger.addItem({
              name: NETWORK_ERROR,
              display: "network error fetching package",
              color: "red"
            });
            logger.updateItem(NETWORK_ERROR, err.message);

            return false;
          })
          .finally(() => {
            this._inflights.tarball.remove(fullTgzFile);
          });

        this._inflights.tarball.add(fullTgzFile, fetchPromise);

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
