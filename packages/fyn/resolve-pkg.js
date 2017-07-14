"use strict";
const Fs = require("fs");
const pkg = JSON.parse(Fs.readFileSync("pkg.json"));
const Promise = require("bluebird");
const _ = require("lodash");
const Fetch = require("node-fetch");
Fetch.Promise = Promise;
const ElectrodeKeepAlive = require("electrode-keepalive");
const Path = require("path");
const Semver = require("semver");
const Yaml = require("js-yaml");

function mapDep(dep, src) {
  return Object.keys(dep).map(name => {
    const semver = dep[name];
    return { name, semver, src, dsrc: src, request: [`${src}`] };
  });
}

const dependencies = mapDep(pkg.dependencies, "dep")
  .concat(mapDep(pkg.devDependencies, "dev"))
  .concat(mapDep(pkg.optionalDependencies, "opt"));

console.log(JSON.stringify(dependencies, null, 2));

const depTree = {};

const knownMeta = {};

/*
 * contains all packages needed and the versions
 */

/*
  * For a given dep,
  * - If dsrc is only opt, that means it's only needed optionally
  * - If dsrc has dep or dev, but src is only opt, then it's only 
  *   needed by an dep that's needed optionally
  * - If both src/dsrc has dep/dev but it's only needed by another dep
  *   which is needed optionally, then it's only needed if the optional 
  *   depdee is installed. To detect this, need to go through all requests
  *   and check if all of them has last entry starts with opt;
  */

const knownPackages = {
  $res: {}
};

const ud = dependencies;

const opts = {
  keepAlive: true,
  keepAliveMsecs: 30000, // socket send keep alive ping every 30 secs
  maxSockets: 100,
  maxFreeSockets: 10,
  https: false
};

const keepAlive = new ElectrodeKeepAlive(opts);

const dnsOptions = {};

const fetchingPromises = {};

const startTime = Date.now();

function handleQueueItemDone(err, id) {
  delete fetchingPromises[id];
  if (ud.length > 0) {
    enqueueMore();
  } else {
    const pending = Object.keys(fetchingPromises);
    console.log("no more items, pending count", pending.length);
    if (pending.length === 0) {
      const endTime = Date.now();
      const elapse = endTime - startTime;
      console.log("done", elapse / 1000);
    }
  }
}

process.on("exit", () => {
  console.log("bye", Object.keys(fetchingPromises), ud);
  Fs.writeFileSync("fyn-data.yaml", Yaml.dump(knownPackages));
  // Fs.writeFileSync("fyn-data.json", JSON.stringify(knownPackages, null, 2));
});

const requestDeps = {};

function makeRequestEntry(item) {
  return `${item.dsrc};${item.name};${item.semver};${item.resolved}`;
}

function addDepOfDep(mPkg, parent) {
  const addDepOfDep = (dep, src) => {
    for (var name in dep) {
      ud.push({
        name: name,
        semver: dep[name],
        src: parent.src,
        dsrc: src,
        request: parent.request.concat(makeRequestEntry(parent)),
        parent
      });
    }
  };

  addDepOfDep(mPkg.dependencies, "dep");
  addDepOfDep(mPkg.optionalDependencies, "opt");
}

function addResolutionToParent(item) {
  let pkg;
  if (item.parent) {
    const x = item.parent;
    const kpkg = knownPackages[x.name];
    pkg = kpkg[x.resolved].$res;
  } else {
    pkg = knownPackages.$res;
  }
  let depSec = pkg[item.dsrc];
  if (!depSec) {
    depSec = pkg[item.dsrc] = {};
  }
  depSec[item.name] = { semver: item.semver, resolved: item.resolved };
}

function addRequestToPkg(pkgV, item) {
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

function findVersionFromDistTag(meta, semver) {
  if (Semver.validRange(semver) === null) {
    if (meta["dist-tags"].hasOwnProperty(semver)) {
      return meta["dist-tags"][semver];
    }
  }
  return undefined;
}

function resolvePackage(item, meta) {
  const resolve = v => {
    item.resolved = v;
    let kpkg = knownPackages[item.name];
    if (!kpkg) {
      kpkg = knownPackages[item.name] = {};
    }
    let pkgV = kpkg[v];
    if (!pkgV) {
      pkgV = kpkg[v] = {
        [item.src]: 0,
        requests: [],
        src: item.src,
        dsrc: item.dsrc,
        $res: {}
      };
      addDepOfDep(meta.versions[v], item);
    }
    addRequestToPkg(pkgV, item);
    addResolutionToParent(item);
  };

  const distTagVer = findVersionFromDistTag(meta, item.semver);
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

function queueFetch(item) {
  const pkgName = item.name;
  if (knownMeta[pkgName]) {
    resolvePackage(item, knownMeta[pkgName]);
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
              knownMeta[pkgName] = JSON.parse(body);
              const fname = pkgName.replace(/[\/\\]/g, "$");
              Fs.writeFileSync(`.cache/meta_${fname}.yaml`, Yaml.safeDump(knownMeta[pkgName]));
              resolvePackage(item, knownMeta[pkgName]);
              //console.log(Object.keys(knownMeta[pkgName].versions));
            })
            .then(() => true);
        }
        return false;
      })
      .then(() => handleQueueItemDone(null, id))
      .catch(err => {
        console.log(`fetch '${pkgName}' failed`, err);
        handleQueueItemDone(err, id);
      });
  });

  fetchingPromises[id] = promise;
}

//
// check known packages for if a version exist to satisfy name@semver
// if none exist, then queue up to fetch meta data for package name
//
function checkAndQueuePackage(item) {
  const { name, semver } = item;
  const kpkg = knownPackages[name];
  if (kpkg) {
    // todo: do semver sort
    const versions = Object.keys(kpkg).sort().reverse();
    const resolve = v => {
      item.resolved = v;
      addRequestToPkg(kpkg[v], item);
      addResolutionToParent(item);
    };
    const distTagVer = findVersionFromDistTag(knownMeta, item.semver);
    if (distTagVer !== undefined) {
      return resolve(distTagVer);
    }
    const foundVer = versions.find(kver => Semver.satisfies(kver, semver));
    if (foundVer) {
      return resolve(foundVer);
    }
  }
  // console.log(`${name}@${semver} not found, queueing`);
  queueFetch(item);
}

const concurrency = 50;

function enqueueMore() {
  const pending = Object.keys(fetchingPromises);

  for (let i = pending.length; i < concurrency; i++) {
    const x = ud.shift();
    if (!x) break;
    checkAndQueuePackage(x);
  }
}

enqueueMore();

//  http  --> 200, req: 'GET https://npme.walmart.com/%40walmart%2Fauth-plugin', bytes: 0/3008
