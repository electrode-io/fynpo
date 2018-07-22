"use strict";

//
// Manages all sources that package data could come from.
// - local cache
// - git repo
// - local dir
// - npm registry
//

/* eslint-disable no-magic-numbers, prefer-template, max-statements */

const crypto = require("crypto");
const { PassThrough } = require("stream");
const needle = require("needle");
const Promise = require("bluebird");
const createDefer = require("./util/defer");
const os = require("os");
const Fs = require("./util/file-ops");
const _ = require("lodash");
const chalk = require("chalk");
const logger = require("./logger");
const mkdirp = require("mkdirp");
const Path = require("path");
const Url = require("url");
const PromiseQueue = require("./util/promise-queue");
const access = Promise.promisify(Fs.access);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);
const rename = Promise.promisify(Fs.rename);
const Inflight = require("./util/inflight");
const logFormat = require("./util/log-format");
const uniqId = require("./util/uniq-id");
const semverUtil = require("./util/semver");
const longPending = require("./long-pending");
const { LOCAL_VERSION_MAPS } = require("./symbols");
const { LONG_WAIT_META, FETCH_META, FETCH_PACKAGE } = require("./log-items");

const WATCH_TIME = 5000;

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
    logger.debug("pkg src manager registry", this._options.registry);
    this._registry = this._options.registry && Url.parse(this._options.registry);
    this._tgzRegistry = _.pick(this._registry, ["protocol", "auth", "host", "port", "hostname"]);
    this._cleanHost = this._registry.host.replace(/[^\w\.]/g, "");
    this._localMeta = {};
    this._netQ = new PromiseQueue({
      concurrency: this._fyn.concurrency,
      stopOnError: true,
      processItem: x => this.processItem(x),
      watchTime: WATCH_TIME
    });

    this._netQ.on("fail", data => logger.error(data));
    this._netQ.on("watch", items => {
      longPending.onWatch(items, {
        name: LONG_WAIT_META,
        filter: x => x.item.type === "meta",
        makeId: x => logFormat.pkgId(x.item),
        _save: false
      });
    });

    this._metaStat = {
      wait: 0,
      inTx: 0,
      done: 0
    };
    this._lastMetaStatus = "waiting...";
  }

  processItem(x) {
    if (x.type === "meta") {
      return this.netRetrieveMeta(x);
    }
    return undefined;
  }

  makePkgCacheDir(pkgName) {
    const pkgCacheDir = Path.join(this._cacheDir, pkgName);
    mkdirp.sync(pkgCacheDir);
    return pkgCacheDir;
  }

  getSemverAsFilepath(semver) {
    if (semver.startsWith("file:")) {
      return semver.substr(5);
    } else if (semver.startsWith("/") || semver.startsWith("./") || semver.startsWith("../")) {
      return semver;
    } else if (semver.startsWith("~/")) {
      return Path.join(os.homedir(), semver.substr(1));
    }
    return false;
  }

  getLocalPackageMeta(item, resolved) {
    return _.get(this._localMeta, [item.name, "byVersion", resolved]);
  }

  getAllLocalMetaOfPackage(name) {
    return _.get(this._localMeta, [name, "byVersion"]);
  }

  /* eslint-disable max-statements */
  fetchLocalItem(item) {
    const localPath = item.semverPath;

    if (!localPath) return false;

    let fullPath;

    if (!Path.isAbsolute(localPath)) {
      const parent = item.parent;
      if (parent.localType) {
        fullPath = Path.join(parent.fullPath, localPath);
      } else {
        fullPath = Path.resolve(this._fyn.cwd, localPath);
      }
    } else {
      fullPath = localPath;
    }

    item.fullPath = fullPath;
    const pkgJsonFile = Path.join(fullPath, "package.json");

    logger.debug("fetchLocalItem localPath", localPath, "fullPath", fullPath);

    const existLocalMeta = _.get(this._localMeta, [item.name, "byPath", fullPath]);

    if (existLocalMeta) {
      existLocalMeta[LOCAL_VERSION_MAPS][item.semver] = existLocalMeta.localId;
      return Promise.resolve(existLocalMeta);
    }

    return readFile(pkgJsonFile).then(raw => {
      const str = raw.toString();
      const json = JSON.parse(str);
      const version = semverUtil.localify(json.version, item.localType);
      const name = item.name || json.name;
      json.dist = {
        localPath,
        fullPath
      };
      const localMeta = {
        local: item.localType,
        localId: version,
        name,
        json,
        jsonStr: str,
        versions: {
          [version]: json
        },
        "dist-tags": {
          latest: version
        },
        [LOCAL_VERSION_MAPS]: {
          [item.semver]: version
        }
      };

      logger.debug(
        "return local meta for",
        item.name,
        item.semver,
        "at",
        fullPath,
        "local version",
        version
      );

      _.set(this._localMeta, [name, "byPath", fullPath], localMeta);
      _.set(this._localMeta, [name, "byVersion", version], localMeta);

      return localMeta;
    });
  }

  formatMetaUrl(item) {
    const reg = Object.assign({}, this._registry);
    const name = item.name.replace("/", "%2F");
    reg.pathname = Path.posix.join(reg.pathname, name);
    return Url.format(reg);
  }

  updateFetchMetaStatus(_render) {
    const { wait, inTx, done } = this._metaStat;
    const statStr = `(${chalk.red(wait)}⇨ ${chalk.yellow(inTx)}⇨ ${chalk.green(done)})`;
    logger.updateItem(FETCH_META, {
      msg: `${statStr} ${this._lastMetaStatus}`,
      _render,
      _save: _render
    });
  }

  netRetrieveMeta(qItem) {
    const pkgName = qItem.item.name;
    let retries = 0;
    const networkRequestId = uniqId();

    const startTime = Date.now();

    const updateItem = status => {
      if (status !== undefined) {
        status = chalk.cyan(`${status}`);
        const time = logFormat.time(Date.now() - startTime);
        const dispName = chalk.red.bgGreen(pkgName);
        this._lastMetaStatus = `${status} ${time} ${dispName}`;
        this.updateFetchMetaStatus();
      }
    };

    const cacheMetaFile = qItem.cacheMetaFile;
    const cached = qItem.cached;
    const metaUrl = this.formatMetaUrl(qItem.item);

    const doRequest = () => {
      const fynFo = cached.fynFo || {};
      cached.fynFo = fynFo;
      const headers = {};
      if (fynFo.etag) {
        headers["if-none-match"] = fynFo.etag;
      } else if (fynFo.lastMod) {
        headers["if-modified-since"] = fynFo.lastMod;
      }
      const promise = Promise.try(() =>
        needle(
          "get",
          metaUrl,
          {},
          {
            compressed: true,
            headers
          }
        )
      )
        .then(response => {
          this._metaStat.inTx--;
          if (response.statusCode === 304) {
            updateItem(response.statusCode);
            return cached;
          }
          if (response.statusCode !== 200) {
            logger.error(
              chalk.red(`meta fetch ${pkgName} failed with status ${response.statusCode}`)
            );
            logger.debug(`meta URL: ${metaUrl}`);
            return undefined;
          }
          const meta = response.body;
          const rh = response.headers;
          if (rh.etag) {
            fynFo.etag = rh.etag;
          } else if (rh["last-modified"]) {
            fynFo.lastMod = rh["last-modified"];
          }
          fynFo.updated = Date.now();
          meta.fynFo = fynFo;
          updateItem(response.statusCode);
          return writeFile(cacheMetaFile, JSON.stringify(meta, null, 2))
            .thenReturn(meta)
            .catch(() => {
              logger.error("write meta cache fail", cacheMetaFile);
            });
        })
        .catch(err => {
          retries++;
          logger.addItem({
            name: networkRequestId,
            display: `Network error fetching meta of ${pkgName}`,
            color: "red"
          });
          logger.updateItem(networkRequestId, err.message + `; Retrying ${retries}`);

          // try again

          return retries < 5
            ? doRequest().tap(() => {
                logger.removeItem(networkRequestId);
              })
            : null;
        });

      return promise;
    };

    this._metaStat.wait--;
    this._metaStat.inTx++;

    this.updateFetchMetaStatus(false);

    return doRequest()
      .then(x => {
        const time = Date.now() - startTime;
        if (time > 20 * 1000) {
          logger.info(
            chalk.red("Fetch meta of package"),
            logFormat.pkgId(qItem.item),
            `took ${logFormat.time(time)}!!!`
          );
        }
        qItem.defer.resolve(x);
      })
      .catch(err => {
        qItem.defer.reject(err);
      });
  }

  hasMeta(item) {
    return Boolean(this._meta[item.name]);
  }

  fetchMeta(item) {
    const pkgName = item.name;

    if (this._meta[pkgName]) {
      return Promise.resolve(this._meta[pkgName]);
    }

    const inflight = this._inflights.meta.get(pkgName);
    if (inflight) {
      return inflight;
    }

    const pkgCacheDir = this.makePkgCacheDir(pkgName);
    const cacheMetaFile = `${pkgCacheDir}/meta-${this._cleanHost}.json`;

    const doRequest = cached => {
      const rd = this._fyn.remoteMetaDisabled;

      if (this._fyn.forceCache) {
        this._metaStat.wait--;
        return cached;
      }

      if (rd) {
        this._metaStat.wait--;
        if (cached) return cached;
        const msg = `option ${rd} has disabled retrieving meta from remote`;
        logger.error(`fetch meta for ${chalk.magenta(pkgName)} error:`, chalk.red(msg));
        throw new Error(msg);
      }

      this.updateFetchMetaStatus(false);

      if (!cached) cached = {};

      // must go out to network.  save up all info and queue it up with netQ

      const netQItem = {
        type: "meta",
        cached,
        cacheMetaFile,
        item,
        defer: createDefer()
      };

      this._netQ.addItem(netQItem);

      return netQItem.defer.promise;
    };

    let foundCache;

    this._metaStat.wait++;

    const promise = access(cacheMetaFile)
      .then(() => {
        return readFile(cacheMetaFile).then(data => JSON.parse(data.toString()));
      })
      .then(cached => {
        foundCache = true;
        logger.debug("found", pkgName, "cache for meta", cacheMetaFile);
        return doRequest(cached);
      })
      .catch(err => {
        if (foundCache) throw err;
        return doRequest();
      })
      .then(meta => {
        this._metaStat.done++;
        this._meta[pkgName] = meta;
        return meta;
      })
      .finally(() => {
        this._inflights.meta.remove(pkgName);
      });

    return this._inflights.meta.add(pkgName, promise);
  }

  formatTarballUrl(item) {
    const tgzFile = `${item.name}-${item.version}.tgz`;

    let tarball = _.get(item, "dist.tarball", "");

    if (this._fyn.ignoreDist || !tarball) {
      // we should still use dist tarball's pathname if it exist because
      // the tarball URL doesn't always match the version in the package.json
      tarball = Url.parse(tarball);
      tarball = Url.format(
        Object.assign(
          _.defaults(tarball, { pathname: `${item.name}/-/${tgzFile}` }),
          this._tgzRegistry
        )
      );
      logger.debug("package tarball url generated", tarball);
    } else {
      logger.debug("package tarball url from dist", tarball);
    }

    return tarball;
  }

  fetchTarball(item) {
    const startTime = Date.now();
    const pkgName = item.name;
    const pkgCacheDir = this.makePkgCacheDir(pkgName);
    const tmpFile = `tmp-${uniqId()}-${item.dist.shasum}-${item.version}.tgz`;
    const tgzFile = `pkg-${item.dist.shasum}-${item.version}.tgz`;
    const fullTmpFile = Path.join(pkgCacheDir, tmpFile);
    const fullTgzFile = Path.join(pkgCacheDir, tgzFile);

    const pkgUrl = this.formatTarballUrl(item);

    let retries = 0;
    const networkRequestId = uniqId();
    const doFetch = () => {
      const shaHash = crypto.createHash("sha1");
      const stream = Fs.createWriteStream(fullTmpFile);
      const pass = new PassThrough();
      pass.on("data", chunk => shaHash.update(chunk));
      return new Promise((resolve, reject) => {
        needle
          .get(pkgUrl, { follow_max: 2 })
          .on("header", resolve)
          .on("done", doneErr => {
            if (doneErr) reject(doneErr);
          })
          .once("err", reject)
          // TODO: .on("timeout")
          .pipe(pass)
          .pipe(stream);
      })
        .then(statusCode => {
          if (statusCode !== 200) {
            logger.error(`fetchTarball: ${pkgUrl} response error`, statusCode);
            return false;
          }
          logger.debug(`fetchTarball: ${pkgUrl} response code`, statusCode);
          return new Promise((resolve, reject) => {
            let closed;
            let finish;
            const close = () => {
              clearTimeout(finish);
              if (closed) return undefined;
              closed = true;
              const shaSum = shaHash.digest("hex");
              logger.debug(`${fullTgzFile} shasum`, shaSum);
              if (shaSum !== item.dist.shasum) {
                const msg = `${fullTgzFile} shasum mismatched`;
                logger.error(msg);
                return reject(new Error(msg));
              }
              const status = chalk.cyan(`${statusCode}`);
              const time = logFormat.time(Date.now() - startTime);
              logger.updateItem(FETCH_PACKAGE, `${status} ${time} ${chalk.red.bgGreen(pkgName)}`);
              return resolve();
            };
            stream.on("finish", () => (finish = setTimeout(close, 1000)));
            stream.on("error", reject);
            stream.on("close", close);
          })
            .then(() => rename(fullTmpFile, fullTgzFile))
            .return({ fullTgzFile });
        })
        .catch(netErr => {
          retries++;
          logger.addItem({
            name: networkRequestId,
            display: `Network error fetching package ${pkgUrl}\n  Error`,
            color: "red"
          });
          logger.updateItem(networkRequestId, netErr.message + `; Retrying ${retries}`);

          if (retries < 5) {
            return doFetch().tap(() => {
              logger.removeItem(networkRequestId);
            });
          }

          logger.error(`fetchTarball: ${pkgUrl} failed:`, netErr.message);
          logger.debug("STACK:", netErr.stack);

          throw netErr;
        });
    };

    const promise = access(fullTgzFile)
      .then(() => ({ fullTgzFile }))
      .catch(err => {
        if (err.code !== "ENOENT") throw err;
        const rd = this._fyn.remoteTgzDisabled;
        if (rd) {
          throw new Error(`option ${rd} has disabled retrieving tarball from remote`);
        }
        const inflight = this._inflights.tarball.get(fullTgzFile);
        if (inflight) {
          return inflight;
        }
        const fetchPromise = doFetch().finally(() => {
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
