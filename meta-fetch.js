"use strict";
const Fs = require("fs");
const pkg = JSON.parse(Fs.readFileSync("pkg.json"));
const Promise = require("bluebird");
const _ = require("lodash");
const Fetch = require("node-fetch");
Fetch.Promise = Promise;
const ElectrodeKeepAlive = require("electrode-keepalive");
const Path = require("path");
//console.log(pkg);
const Semver = require("semver");
// const dependencies = Object.keys(pkg.dependencies).map(name => {
//   return { name, semver: pkg.dependencies[name] }; // .concat(pkg.devDependencies);
// });

const dependencies = Fs.readFileSync(Path.resolve("xu")).toString().split("\n").filter(_.identity).map(name => {
  return { name }; // .concat(pkg.devDependencies);
});

const depTree = {};

const meta = {
  a: {
    meta: {
      versions: {
        "1.1.5": {}
      }
    }
  }
};

const samplePackages = {
  lodash: {
    semvers: {
      "^3.0.0": {
        dependencies: true,
        resolved: "3.1.2"
      }
    }
  },
  yargs: {
    semvers: {
      "^6.0.0": {
        from: {
          x: {
            version: "1.1.0",
            dependencies: true
          }
        },
        count: 1,
        resolved: "6.5.0"
      },
      "^8.0.0": {
        count: 1,
        resolved: "8.1.2"
      }
    },
    resolved: {
      "6.5.0": { refCount: 1 },
      "8.1.2": { refCount: 1 }
    }
  }
};

const sampleDepTree = {
  _package: {
    // original package.json
  },
  a: {
    dependencies: {
      semver: "^1.0.0",
      resolved: "1.1.5"
    },
    devDependencies: false,
    optionalDependencies: false,
    depTree: {
      b: {}
    }
  }
};

/*
 * contains all packages needed and the versions
 */

const knownPackages = {};

const ud = _.uniq(dependencies);

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
    queueFetch(ud.shift());
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
  console.log("bye", Object.keys(fetchingPromises));
});

const requestDeps = {};

function queueFetch(item) {
  if (meta[item.name]) {
    return true;
  }

  const pkgName = item.name;
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
              meta[pkgName] = JSON.parse(body);
              //console.log(Object.keys(meta[pkgName].versions));
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

// check known packages for if a version exist to satisfy name@semver
// if none exist, then queue up to fetch meta data for package name
function checkAndQueuePackage(name, semver) {
  for( kn in knownPackages ) {
    const pkg = knownPackages[kn];
    const foundVer = Object.keys(pkg).sort().reverse().find(kver => {
      if (Semver.satisfies(kver, semver )) {
        return kver;
      }
      return false;
    });
    if (foundVer) {
      return foundVer;
    }
  }
  console.log(`${name}@${semver} not found, queueing`);
}

const concurrency = 50;

// for (let i = 0; i < concurrency; i++) {
//   queueFetch(ud.shift());
// }

console.log(ud.shift());

//  http  --> 200, req: 'GET https://npme.walmart.com/%40walmart%2Fauth-plugin', bytes: 0/3008
