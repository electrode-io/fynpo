"use strict";

//
// Manages all sources that package data could come from.
// - local cache
// - git repo
// - local dir
// - npm registry
//

/* eslint-disable no-magic-numbers, prefer-template, max-statements */

const Promise = require("bluebird");
const cacache = require("cacache");
const createDefer = require("./util/defer");
const os = require("os");
const pacote = require("pacote");
const _ = require("lodash");
const chalk = require("chalk");
const logger = require("./logger");
const mkdirp = require("mkdirp");
const Path = require("path");
const Url = require("url");
const PromiseQueue = require("./util/promise-queue");
const Inflight = require("./util/inflight");
const logFormat = require("./util/log-format");
const semverUtil = require("./util/semver");
const longPending = require("./long-pending");
const { LOCAL_VERSION_MAPS, PACKAGE_RAW_INFO } = require("./symbols");
const { LONG_WAIT_META, FETCH_META, FETCH_PACKAGE } = require("./log-items");

const WATCH_TIME = 5000;

class PkgSrcManager {
  constructor(options) {
    this._options = _.defaults({}, options, {
      registry: "",
      fynCacheDir: ""
    });
    this._meta = {};
    this._manifest = {};
    this._cacheDir = this._options.fynCacheDir;
    mkdirp.sync(this._cacheDir);
    this._inflights = {
      meta: new Inflight()
    };
    this._fyn = options.fyn;
    logger.debug("pkg src manager registry", this._options.registry);
    const registry = this._options.registry && Url.parse(this._options.registry);
    this._registry = Url.format(_.pick(registry, ["protocol", "auth", "host", "port", "hostname"]));
    logger.info("PkgSrcManager registry", this._registry);
    this._tgzRegistry = registry;
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

    this._pacoteOpts = { cache: this._cacheDir, registry: this._registry };

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

  getPacoteOpts(extra) {
    return Object.assign({}, extra, this._pacoteOpts);
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

    return this._fyn.loadPackageJsonFile(pkgJsonFile).then(json => {
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
        jsonStr: json[PACKAGE_RAW_INFO].str,
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

    const pacoteRequest = () => {
      return pacote
        .packument(
          pkgName,
          this.getPacoteOpts({
            "full-metadata": false,
            "fetch-retries": 3
          })
        )
        .tap(x => {
          this._metaStat.inTx--;
          updateItem(x._cached ? "cached" : "200");
        })
        .catch(err => {
          const display = `failed fetching packument of ${pkgName}`;
          logger.error(chalk.yellow(display), chalk.red(err.message));
        });
    };

    this._metaStat.wait--;
    this._metaStat.inTx++;

    this.updateFetchMetaStatus(false);

    return pacoteRequest()
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

      // if (!cached) cached = {};

      // must go out to network.  save up all info and queue it up with netQ

      const netQItem = {
        type: "meta",
        // cached,
        // cacheMetaFile,
        item,
        defer: createDefer()
      };

      this._netQ.addItem(netQItem);

      return netQItem.defer.promise;
    };

    let foundCache;

    this._metaStat.wait++;

    // first ask pacote to get packument from cache
    // TODO: pass in offline/prefer-offline/prefer-online flags to pacote so it can
    // handle these directly.
    const promise = pacote
      .packument(
        pkgName,
        this.getPacoteOpts({
          offline: true,
          "full-metadata": false,
          "fetch-retries": 3
        })
      )
      .then(cached => {
        foundCache = true;
        logger.debug("found", pkgName, "packument cache");
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

  pacotePrefetch(pkgId, integrity) {
    const stream = this.pacoteTarballStream(pkgId, integrity);

    const defer = createDefer();
    stream.once("end", () => {
      stream.destroy();
      defer.resolve();
    });
    stream.once("error", defer.reject);
    stream.on("data", _.noop);

    return defer.promise;
  }

  pacoteTarballStream(pkgId, integrity) {
    return pacote.tarball.stream(pkgId, this.getPacoteOpts({ integrity }));
  }

  getIntegrity(item) {
    const integrity = _.get(item, "dist.integrity");
    if (integrity) return integrity;

    const shasum = _.get(item, "dist.shasum");

    if (shasum) {
      const b64 = Buffer.from(shasum, "hex").toString("base64");
      return `sha1-${b64}`;
    }

    return undefined;
  }

  fetchTarball(item) {
    const startTime = Date.now();
    const pkgId = `${item.name}@${item.version}`;
    const integrity = this.getIntegrity(item);

    const doFetch = () => {
      const fetchStartTime = Date.now();

      if (!this._fetching) {
        this._fetching = [];
        this._fetchingMsg = "waiting...";
      }

      this._fetching.push(pkgId);

      logger.updateItem(FETCH_PACKAGE, `${this._fetching.length} ${this._fetchingMsg}`);

      return this.pacotePrefetch(pkgId, integrity).then(() => {
        const status = chalk.cyan(`200`);
        const time = logFormat.time(Date.now() - fetchStartTime);
        const ix = this._fetching.indexOf(pkgId);
        this._fetching.splice(ix, 1);
        this._fetchingMsg = `${status} ${time} ${chalk.red.bgGreen(item.name)}`;
        logger.updateItem(FETCH_PACKAGE, `${this._fetching.length} ${this._fetchingMsg}`);
        return this.pacoteTarballStream(pkgId, integrity);
      });
    };

    // - check cached tarball with manifest._integrity
    // - use stream from cached tarball if exist
    // - else fetch from network

    const promise = cacache.get.hasContent(this._cacheDir, integrity).then(content => {
      if (content) return this.pacoteTarballStream(pkgId, integrity);
      const rd = this._fyn.remoteTgzDisabled;
      if (rd) {
        throw new Error(`option ${rd} has disabled retrieving tarball from remote`);
      }
      return doFetch();
    });

    return {
      then: (r, e) => promise.then(r, e),
      catch: e => promise.catch(e),
      tap: f => promise.tap(f),
      promise,
      startTime
    };
  }
}

module.exports = PkgSrcManager;
