"use strict";
const Fs = require("fs");
const Promise = require("bluebird");
const _ = require("lodash");
const Fetch = require("node-fetch");
Fetch.Promise = Promise;
const ElectrodeKeepAlive = require("electrode-keepalive");
const Path = require("path");
const Semver = require("semver");
const Yaml = require("js-yaml");

const opts = {
  keepAlive: true,
  keepAliveMsecs: 30000, // socket send keep alive ping every 30 secs
  maxSockets: 100,
  maxFreeSockets: 10,
  https: false
};

const keepAlive = new ElectrodeKeepAlive(opts);

const dnsOptions = {};

function mapDep(dep, src) {
  return Object.keys(dep).map(name => {
    const semver = dep[name];
    return { name, semver, src, dsrc: src, request: [`${src}`] };
  });
}

function makeRequestEntry(item) {
  return `${item.dsrc};${item.name};${item.semver};${item.resolved}`;
}

class PkgDepResolver {
  constructor(pkg, options) {
    options = options || {};
    this._meta = {};
    this._data = {
      pkgs: {},
      res: {}
    };
    this._concurrency = options.concurrency || 50;
    this._pkgs = this._data.pkgs;
    this._ud = mapDep(pkg.dependencies, "dep")
      .concat(mapDep(pkg.devDependencies, "dev"))
      .concat(mapDep(pkg.optionalDependencies, "opt"));
    this._fetchingPromises = {};
    this._startTime = undefined;
  }

  handleQueueItemDone(err, id) {
    delete this._fetchingPromises[id];
    if (this._ud.length > 0) {
      this.enqueueMore();
    } else {
      const pending = Object.keys(this._fetchingPromises);
      console.log("no more items, pending count", pending.length);
      if (pending.length === 0) {
        const endTime = Date.now();
        const elapse = endTime - this._startTime;
        console.log("done", elapse / 1000);
        console.log("bye", Object.keys(this._fetchingPromises), this._ud);
        Fs.writeFileSync("fyn-data.yaml", Yaml.dump(this._data));
      }
    }
  }

  addDepOfDep(mPkg, parent) {
    const add = (dep, src) => {
      for (var name in dep) {
        this._ud.push({
          name: name,
          semver: dep[name],
          src: parent.src,
          dsrc: src,
          request: parent.request.concat(makeRequestEntry(parent)),
          parent
        });
      }
    };

    add(mPkg.dependencies, "dep");
    add(mPkg.optionalDependencies, "opt");
  }

  addResolutionToParent(item) {
    let pkg;
    if (item.parent) {
      const x = item.parent;
      const kpkg = this._pkgs[x.name];
      pkg = kpkg[x.resolved].res;
    } else {
      pkg = this._data.res;
    }
    let depSec = pkg[item.dsrc];
    if (!depSec) {
      depSec = pkg[item.dsrc] = {};
    }
    depSec[item.name] = { semver: item.semver, resolved: item.resolved };
  }

  addRequestToPkg(pkgV, item) {
    if (pkgV[item.src] === undefined) {
      pkgV[item.src] = 0;
    }
    pkgV[item.src]++;
    item.request.push(`${item.dsrc};${item.semver}`);
    pkgV.requests.push(item.request);
    if (pkgV.dsrc.indexOf(item.dsrc) < 0) {
      pkgV.dsrc += `;${item.dsrc}`;
    }
    if (pkgV.src.indexOf(item.src) < 0) {
      pkgV.src += `;${item.src}`;
    }
  }

  findVersionFromDistTag(meta, semver) {
    if (Semver.validRange(semver) === null) {
      if (meta["dist-tags"].hasOwnProperty(semver)) {
        return meta["dist-tags"][semver];
      }
    }
    return undefined;
  }

  resolvePackage(item, meta) {
    const resolve = v => {
      item.resolved = v;
      let kpkg = this._pkgs[item.name];
      if (!kpkg) {
        kpkg = this._pkgs[item.name] = {};
      }
      let pkgV = kpkg[v];
      if (!pkgV) {
        pkgV = kpkg[v] = {
          [item.src]: 0,
          requests: [],
          src: item.src,
          dsrc: item.dsrc,
          dist: meta.versions[v].dist,
          res: {}
        };
        this.addDepOfDep(meta.versions[v], item);
      }
      this.addRequestToPkg(pkgV, item);
      this.addResolutionToParent(item);
    };

    const distTagVer = this.findVersionFromDistTag(meta, item.semver);
    if (distTagVer !== undefined) {
      return resolve(distTagVer);
    }
    // todo: do semver sort
    const versions = Object.keys(meta.versions).sort().reverse();
    const fver = versions.find(v => {
      if (Semver.satisfies(v, item.semver)) {
        resolve(v);
        return true;
      }
      return false;
    });
    if (!fver) {
      throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
    }
  }

  queueFetch(item) {
    const pkgName = item.name;
    if (this._meta[pkgName]) {
      this.resolvePackage(item, this._meta[pkgName]);
      return true;
    }

    const id = `${pkgName}-${Date.now()}`;

    let npmUrl = "http://localhost:4873";
    // npmUrl = "https://npme.walmart.com";
    const promise = new Promise((resolve, reject) => {
      keepAlive.preLookup("localhost", dnsOptions, err => {
        return err ? reject(err) : resolve();
      });
    }).then(() => {
      return Fetch(`${npmUrl}/${encodeURIComponent(pkgName)}`, {
        redirect: "manual",
        //      timeout: 30000,
        compress: true,
        agent: keepAlive.agent
      })
        .then(resp => {
          if (resp.status === 200) {
            return resp
              .text()
              .then(body => {
                console.log(`fetch ${pkgName} result ${resp.status} ${typeof body}`);
                this._meta[pkgName] = JSON.parse(body);
                const fname = pkgName.replace(/[\/\\]/g, "$");
                Fs.writeFileSync(`.cache/meta_${fname}.yaml`, Yaml.safeDump(this._meta[pkgName]));
                this.resolvePackage(item, this._meta[pkgName]);
                //console.log(Object.keys(this._meta[pkgName].versions));
              })
              .then(() => true);
          }
          return false;
        })
        .then(() => this.handleQueueItemDone(null, id))
        .catch(err => {
          console.log(`fetch '${pkgName}' failed`, err);
          this.handleQueueItemDone(err, id);
        });
    });

    this._fetchingPromises[id] = promise;
  }

  //
  // check known packages for if a version exist to satisfy name@semver
  // if none exist, then queue up to fetch meta data for package name
  //
  checkAndQueuePackage(item) {
    const { name, semver } = item;
    const kpkg = this._pkgs[name];
    if (kpkg) {
      const distTagVer = this.findVersionFromDistTag(this._meta[name], item.semver);
      if (distTagVer !== undefined) {
        return resolve(distTagVer);
      }
      // todo: do semver sort
      const versions = Object.keys(kpkg).sort().reverse();
      const resolve = v => {
        item.resolved = v;
        this.addRequestToPkg(kpkg[v], item);
        this.addResolutionToParent(item);
      };
      const foundVer = versions.find(kver => Semver.satisfies(kver, semver));
      if (foundVer) {
        return resolve(foundVer);
      }
    }
    // console.log(`${name}@${semver} not found, queueing`);
    this.queueFetch(item);
  }

  enqueueMore() {
    if (!this._startTime) {
      this._startTime = Date.now();
    }
    const pending = Object.keys(this._fetchingPromises);

    for (let i = pending.length; i < this._concurrency; i++) {
      const x = this._ud.shift();
      if (!x) break;
      this.checkAndQueuePackage(x);
    }
  }
}

module.exports = PkgDepResolver;

const resolver = new PkgDepResolver(JSON.parse(Fs.readFileSync("pkg.json")));
resolver.enqueueMore();
