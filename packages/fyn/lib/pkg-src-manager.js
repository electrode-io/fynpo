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
const Fs = require("./util/file-ops");
const logger = require("./logger");
const mkdirp = require("mkdirp");
const Path = require("path");
const PromiseQueue = require("./util/promise-queue");
const Inflight = require("./util/inflight");
const logFormat = require("./util/log-format");
const semverUtil = require("./util/semver");
const longPending = require("./long-pending");
const { LOCAL_VERSION_MAPS, PACKAGE_RAW_INFO, DEP_ITEM } = require("./symbols");
const { LONG_WAIT_META, FETCH_META, FETCH_PACKAGE } = require("./log-items");
const PkgPreper = require("pkg-preper");
const VisualExec = require("visual-exec");
const { readPkgJson, missPipe } = require("./util/fyntil");
const { MARK_URL_SPEC } = require("./constants");
const nodeFetch = require("node-fetch-npm");
const { AggregateError } = require("@jchip/error");
const { prePackObj } = require("publish-util");

const WATCH_TIME = 5000;

// consider meta cache stale after this much time (30 minutes)
const META_CACHE_STALE_TIME = 30 * 60 * 1000;

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
      meta: new Inflight()
    };
    this._fyn = options.fyn;

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

    const registryData = _.pickBy(
      this._options,
      (v, key) => key === "registry" || key.endsWith(":registry")
    );

    const authTokens = _.pickBy(this._options, (v, key) => key.endsWith(":_authToken"));

    logger.debug("pkg src manager registry", JSON.stringify(registryData));

    this._pacoteOpts = Object.assign(
      {
        cache: this._cacheDir,
        email: this._options.email,
        alwaysAuth: this._options["always-auth"],
        username: this._options.username,
        password: this._options.password
      },
      authTokens,
      registryData
    );

    this._regData = registryData;
    this.normalizeRegUrlSlash();

    this._metaStat = {
      wait: 0,
      inTx: 0,
      done: 0
    };
    this._lastMetaStatus = "waiting...";
  }

  normalizeRegUrlSlash() {
    _.each(this._regData, (v, k) => {
      this._regData[k] = v.endsWith("/") ? v : `${v}/`;
    });
  }

  getRegistryUrl(pkgName) {
    let regUrl = this._regData.registry;
    if (pkgName.startsWith("@")) {
      const scope = pkgName.split("/")[0];
      const k = `${scope}:registry`;
      if (this._regData[k]) {
        regUrl = this._regData[k];
      }
    }

    return regUrl;
  }

  makePackumentUrl(pkgName) {
    const escapedName = pkgName.replace("/", "%2f");
    const regUrl = this.getRegistryUrl(pkgName);
    return `${regUrl}${escapedName}`;
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

    logger.debug("fetchLocalItem localPath", localPath, "fullPath", fullPath);

    const existLocalMeta = _.get(this._localMeta, [item.name, "byPath", fullPath]);

    if (existLocalMeta) {
      existLocalMeta[LOCAL_VERSION_MAPS][item.semver] = existLocalMeta.localId;
      return Promise.resolve(existLocalMeta);
    }

    return readPkgJson(fullPath, true, true).then(json => {
      if (
        json.publishUtil ||
        _.get(json, ["dependencies", "publish-util"]) ||
        _.get(json, ["devDependencies", "publish-util"])
      ) {
        logger.info(
          `processing local package.json at ${fullPath} with https://www.npmjs.com/package/publish-util prePackObj`
        );
        prePackObj(json, { ...json.publishUtil, silent: true });
      }

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

    //
    // where fetch will ultimately occur and cached
    // make-fetch-happen/index.js:106 (cachingFetch)
    //   - missing cache ==> remoteFetch
    //   - found cache   ==> conditionalFetch
    // make-fetch-happen/index.js:143 (isStale check)
    //
    // make-fetch-happen/index.js:229 (conditionalFetch) ==> remoteFetch
    // make-fetch-happen/index.js:256 (304 Not Modified handling) (just returncachedRes?)
    //
    // make-fetch-happen/index.js:309 (remoteFetch)
    // make-fetch-happen/index.js:352 (caching)
    //
    const pacoteRequest = () => {
      return pacote
        .packument(
          pkgName,
          this.getPacoteOpts({
            "full-metadata": true,
            "fetch-retries": 3,
            "cache-policy": "ignore",
            "cache-key": qItem.cacheKey,
            memoize: false
          })
        )
        .tap(x => {
          this._metaStat.inTx--;
          if (x.readme) delete x.readme; // don't need this
          updateItem(x._cached ? "cached" : "200");
        })
        .catch(err => {
          const msg = `pacote failed fetching packument of ${pkgName}`;
          logger.error(chalk.yellow(msg), chalk.red(err.message));
          throw new AggregateError([err], msg);
        });
    };

    this._metaStat.wait--;
    this._metaStat.inTx++;

    this.updateFetchMetaStatus(false);

    const promise = qItem.item.urlType ? this.fetchUrlSemverMeta(qItem.item) : pacoteRequest();

    return promise
      .then(x => {
        const time = Date.now() - startTime;
        if (time > 20 * 1000) {
          logger.info(
            chalk.red("Fetch meta of package"),
            logFormat.pkgId(qItem.item),
            `took ${logFormat.time(time)}!!!`
          );
        }
        cacache.refresh(this._cacheDir, qItem.cacheKey);
        qItem.defer.resolve(x);
      })
      .catch(err => {
        qItem.defer.reject(err);
      });
  }

  hasMeta(item) {
    return Boolean(this._meta[item.name]);
  }

  pkgPreperInstallDep(dir, displayTitle) {
    const node = process.env.NODE || process.execPath;
    const fyn = Path.join(__dirname, "../bin/fyn.js");
    return new VisualExec({
      displayTitle,
      cwd: dir,
      command: `${node} ${fyn} --pg simple -q v install --no-production`,
      visualLogger: logger
    }).execute();
  }

  _getPacoteDirPacker() {
    const pkgPrep = new PkgPreper({
      tmpDir: this._cacheDir,
      installDependencies: this.pkgPreperInstallDep
    });
    return pkgPrep.getDirPackerCb();
  }

  _packDir(manifest, dir) {
    return this._getPacoteDirPacker()(manifest, dir);
  }

  fetchUrlSemverMeta(item) {
    let dirPacker;

    if (item.urlType.startsWith("git")) {
      //
      // pacote's implementation of this is not ideal. It always want to
      // clone and pack the dir for manifest or tarball.
      //
      // So, in the latest npm (as of 6.4.0), it ends up doing twice a full
      // git clone, install dependencies, pack to tgz, and cache the result.
      //
      // Even with package-lock.json, npm still ends up cloning the repo and
      // install dependencies to pack tgz, despite that tgz may be in cache already.
      //
      // To make this more efficient, fyn use pacote only for figuring out
      // git and clone the package.
      // Then it moves the cloned dir away for its own use, and throw an
      // exception to make pacote bail out.
      //
      // To figure out the HEAD commit hash, pacote still ends up having to
      // clone the repo because looks like github doesn't set HEAD ref
      // for default branch.  So ls-remote doesn't have the HEAD symref.
      //
      // Ideally, it'd be nice if pacote has API to return the resolved URL first
      // before doing a git clone, so we can lookup from cache with it.
      // however, sometimes a clone is required to find the default branch from github.
      // maybe use github API to find default branch.
      // also, should check if there's only one branch and use that automatically.
      //
      dirPacker = (manifest, dir) => {
        const err = new Error("interrupt pacote");
        const capDir = `${dir}-fyn`;
        return Fs.rename(dir, capDir).then(() => {
          err.capDir = capDir;
          err.manifest = manifest;
          throw err;
        });
      };
    } else {
      dirPacker = this._getPacoteDirPacker();
    }

    return pacote
      .manifest(`${item.name}@${item.semver}`, this.getPacoteOpts({ dirPacker }))
      .then(manifest => {
        manifest = Object.assign({}, manifest);
        return {
          name: item.name,
          versions: {
            [manifest.version]: manifest
          },
          urlVersions: {
            [item.semver]: manifest
          }
        };
      })
      .catch(err => {
        if (!err.capDir) throw err;
        return this._prepPkgDirForManifest(item, err.manifest, err.capDir);
      });
  }

  async _prepPkgDirForManifest(item, manifest, dir) {
    //
    // The full git url with commit hash should be available in manifest._resolved
    // use that as cache key to lookup cached manifest
    //
    const tgzCacheKey = `fyn-tarball-for-${manifest._resolved}`;
    const tgzCacheInfo = await cacache.get.info(this._cacheDir, tgzCacheKey);

    let pkg;
    let integrity;

    if (tgzCacheInfo) {
      // found cache
      pkg = tgzCacheInfo.metadata;
      integrity = tgzCacheInfo.integrity;
      logger.debug("gitdep package", pkg.name, "found cache for", manifest._resolved);
    } else {
      //
      // prepare and pack dir into tgz
      //
      const packStream = this._packDir(manifest, dir);
      await new Promise((resolve, reject) => {
        packStream.on("prepared", resolve);
        packStream.on("error", reject);
      });
      pkg = await readPkgJson(dir);
      logger.debug("gitdep package", pkg.name, "prepared", manifest._resolved);
      //
      // cache tgz
      //
      const cacheStream = cacache.put.stream(this._cacheDir, tgzCacheKey, { metadata: pkg });
      cacheStream.on("integrity", i => (integrity = i.sha512[0].source));
      await missPipe(packStream, cacheStream);
      logger.debug("gitdep package", pkg.name, "cached with integrity", integrity);
    }

    // embed info into tarball URL as a JSON string
    const tarball = JSON.stringify(
      Object.assign(_.pick(item, ["urlType", "semver"]), _.pick(manifest, ["_resolved", "_id"]))
    );

    manifest = Object.assign(
      {},
      pkg,
      _.pick(manifest, ["_resolved", "_integrity", "_shasum", "_id"]),
      {
        dist: {
          integrity,
          tarball: `${MARK_URL_SPEC}${tarball}`
        }
      }
    );

    await Fs.$.rimraf(dir);

    return {
      name: item.name,
      versions: {
        [manifest.version]: manifest
      },
      urlVersions: {
        [item.semver]: manifest
      }
    };
  }

  fetchMeta(item) {
    const pkgName = item.name;
    const pkgKey = `${pkgName}@${item.urlType ? item.urlType : "semver"}`;

    if (this._meta[pkgKey]) {
      return Promise.resolve(this._meta[pkgKey]);
    }

    const inflight = this._inflights.meta.get(pkgKey);
    if (inflight) {
      return inflight;
    }

    const packumentUrl = this.makePackumentUrl(pkgName);
    const cacheKey = `make-fetch-happen:request-cache:full:${packumentUrl}`;

    const queueMetaFetchRequest = cached => {
      const offline = this._fyn.remoteMetaDisabled;

      if (cached && this._fyn.forceCache) {
        this._metaStat.wait--;
        return cached;
      }

      if (offline) {
        this._metaStat.wait--;
        if (cached) return cached;
        const msg = `option ${offline} has disabled retrieving meta from remote`;
        logger.error(`fetch meta for ${chalk.magenta(pkgName)} error:`, chalk.red(msg));
        throw new Error(`${msg} for ${pkgName}`);
      }

      this.updateFetchMetaStatus(false);

      const netQItem = {
        type: "meta",
        cacheKey,
        item,
        defer: createDefer()
      };

      this._netQ.addItem(netQItem);
      return netQItem.defer.promise;
    };

    this._metaStat.wait++;

    //
    // First check if cache has packument for the package
    //
    // TODO: Maybe pass in offline/prefer-offline/prefer-online flags to pacote so it can
    // handle these directly.
    //
    // Sample cache key created by make-fetch-happen
    // See https://github.com/zkat/make-fetch-happen/blob/508c0af20e02f86445fc9b278382abac811f0393/cache.js#L16
    //
    // "make-fetch-happen:request-cache:https://registry.npmjs.org/electrode-static-paths"
    // "make-fetch-happen:request-cache:https://registry.npmjs.org/@octokit%2frest"
    //

    //
    // Much slower way to get cache with pacote
    //
    // const promise = pacote
    //   .packument(
    //     pkgName,
    //     this.getPacoteOpts({
    //       offline: true,
    //       "full-metadata": true,
    //       "fetch-retries": 3
    //     })
    //   )

    let foundCache;
    let cacheMemoized = false;
    const metaMemoizeUrl = this._fyn._options.metaMemoize;

    const promise = (item.urlType
      ? // when the semver is a url then the meta is not from npm registry and
        // we can't use the cache for registry
        Promise.resolve()
      : cacache.get(this._cacheDir, cacheKey, { memoize: true })
    )
      .then(cached => {
        const packument = cached && cached.data && JSON.parse(cached.data);
        foundCache = cached;
        const stale = Date.now() - cached.refreshTime;
        logger.debug(
          "found",
          pkgName,
          "packument cache, refreshTime",
          cached.refreshTime,
          "since",
          (stale / 1000).toFixed(2),
          "secs"
        );
        if (
          this._fyn._options.refreshMeta !== true &&
          cached &&
          cached.refreshTime &&
          stale < META_CACHE_STALE_TIME
        ) {
          cacheMemoized = true;
          this._metaStat.wait--;
          return packument;
        } else if (cached && metaMemoizeUrl) {
          const encKey = encodeURIComponent(cacheKey);
          return nodeFetch(`${metaMemoizeUrl}?key=${encKey}`).then(
            res => {
              if (res.status === 200) {
                logger.debug(pkgName, "using memoized packument cache");
                cacheMemoized = true;
                this._metaStat.wait--;
                return packument;
              }
              return queueMetaFetchRequest(packument);
            },
            () => queueMetaFetchRequest(packument)
          );
        } else {
          return queueMetaFetchRequest(packument);
        }
      })
      .catch(err => {
        if (foundCache) {
          logger.debug(
            "fail to process packument cache",
            err.message,
            "data",
            foundCache.data && foundCache.data.toString()
          );
          throw err;
        }
        return queueMetaFetchRequest();
      })
      .then(meta => {
        this._metaStat.done++;
        this._meta[pkgKey] = meta;
        if (!cacheMemoized && metaMemoizeUrl) {
          const encKey = encodeURIComponent(cacheKey);
          nodeFetch(`${metaMemoizeUrl}?key=${encKey}`, { method: "POST", body: "" }).then(
            _.noop,
            _.noop
          );
        }
        return meta;
      })
      .finally(() => {
        this._inflights.meta.remove(pkgKey);
      });

    return this._inflights.meta.add(pkgKey, promise);
  }

  pacotePrefetch(pkgId, pkgInfo, integrity) {
    const stream = this.pacoteTarballStream(pkgId, pkgInfo, integrity);

    const defer = createDefer();
    stream.once("end", () => {
      if (stream.destroy) stream.destroy();
      defer.resolve();
    });
    stream.once("error", defer.reject);
    stream.on("data", _.noop);

    return defer.promise;
  }

  cacacheTarballStream(integrity) {
    return cacache.get.stream.byDigest(this._cacheDir, integrity);
  }

  pacoteTarballStream(pkgId, pkgInfo, integrity) {
    const opts = this.getPacoteOpts({
      // pacote please reuse manifest
      fullMeta: true,
      integrity,
      // pacote please don't try to get manifest
      // https://github.com/zkat/pacote/blob/3d0354ab990ce7adb6f5b4899e7ed9ffef4fca61/lib/fetchers/registry/tarball.js#L23
      resolved: _.get(pkgInfo, "dist.tarball")
    });
    return pacote.tarball.stream(pkgId, opts);
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

  tarballFetchId(pkgInfo) {
    const di = pkgInfo[DEP_ITEM];
    if (di && di.urlType) return `${di.name}@${di.semver}`;

    return `${pkgInfo.name}@${pkgInfo.version}`;
  }

  async getCentralPackage(integrity, pkgInfo) {
    const { central, copy } = this._fyn;

    const tarId = this.tarballFetchId(pkgInfo);

    const tarStream = async () => {
      return integrity && (await cacache.get.hasContent(this._cacheDir, integrity))
        ? this.cacacheTarballStream(integrity)
        : this.pacoteTarballStream(tarId, pkgInfo, integrity);
    };

    // TODO: probably don't want to do central for github/url/file tarballs
    // If a dep is pointing to a tgz file directly, then there is no integrity
    // and best to avoid doing central storage for it.
    if (integrity && central) {
      const verId = `${pkgInfo.name}@${pkgInfo.version}`;
      const dispId = logFormat.pkgId(verId);

      if (copy.indexOf(pkgInfo.name) >= 0 || copy.indexOf(verId) >= 0) {
        logger.info(`copying pkg ${dispId} in central store mode due to copy option`);
      } else if (!(await central.allow(integrity))) {
        logger.info(
          `copying pkg ${dispId} in central store mode because it mutates in postinstall step.`
        );
      } else {
        const hasCentral = await central.has(integrity);

        if (!hasCentral) {
          await central.storeTarStream(tarId, integrity, tarStream);
        }

        return integrity;
      }
    }

    return tarStream();
  }

  fetchTarball(pkgInfo) {
    const startTime = Date.now();
    const pkgId = this.tarballFetchId(pkgInfo);
    const integrity = this.getIntegrity(pkgInfo);

    const doFetch = () => {
      const fetchStartTime = Date.now();

      if (!this._fetching) {
        this._fetching = [];
        this._fetchingMsg = "waiting...";
      }

      this._fetching.push(pkgId);

      logger.updateItem(FETCH_PACKAGE, `${this._fetching.length} ${this._fetchingMsg}`);

      return this.pacotePrefetch(pkgId, pkgInfo, integrity).then(() => {
        const status = chalk.cyan(`200`);
        const time = logFormat.time(Date.now() - fetchStartTime);
        const ix = this._fetching.indexOf(pkgId);
        this._fetching.splice(ix, 1);
        this._fetchingMsg = `${status} ${time} ${chalk.red.bgGreen(pkgInfo.name)}`;
        logger.updateItem(FETCH_PACKAGE, `${this._fetching.length} ${this._fetchingMsg}`);
        return this.getCentralPackage(integrity, pkgInfo);
      });
    };

    // - check cached tarball with manifest._integrity
    // - use stream from cached tarball if exist
    // - else fetch from network

    const promise = cacache.get
      .hasContent(this._cacheDir, integrity)
      .catch(() => false)
      .then(content => {
        if (content) {
          return this.getCentralPackage(integrity, pkgInfo);
        }

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
