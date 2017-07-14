"use strict";
const Fs = require("fs");
const pkg = JSON.parse(Fs.readFileSync("pkg.json"));
const Promise = require("bluebird");
const _ = require("lodash");
const ElectrodeKeepAlive = require("electrode-keepalive");
const Path = require("path");
const writeFile = Promise.promisify(Fs.writeFile);
const request = require("request");
//console.log(pkg);

// const dependencies = Object.keys(pkg.dependencies).map(name => {
//   return { name, semver: pkg.dependencies[name] }; // .concat(pkg.devDependencies);
// });

const dependencies = Fs.readFileSync(Path.resolve("pkgxu")).toString().split("\n").filter(_.identity).map(name => {
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

let finals = ["selenium-server@3.4.0"];

function handleQueueItemDone(err, id) {
  delete fetchingPromises[id];
  if (ud.length > 0) {
    queueFetch(ud.shift());
  } else {
    const pending = Object.keys(fetchingPromises);
    if (pending.length < 5) {
      console.log("no more items, pending", JSON.stringify(fetchingPromises, null, 2));
    } else {
      console.log("no more items, pending count", pending.length);
    }
    if (pending.length === 0) {
      if (finals.length === 0) {
        const endTime = Date.now();
        const elapse = endTime - startTime;
        console.log("done", elapse / 1000);
      } else {
        const name = finals.pop();
        console.log("now doing", name);
        queueFetch({ name });
      }
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
  const pkgParts = item.name.split("/");

  const pkgBaseParts = _.last(pkgParts).split("@");
  const pkgName = pkgBaseParts[0];
  const pkgVersion = pkgBaseParts[1];
  const pkgTgzFile = `${pkgName}-${pkgVersion}.tgz`;

  let pkgPath;
  if (pkgParts.length === 2) {
    pkgPath = `${pkgParts[0]}/${pkgName}`;
  } else {
    pkgPath = `${pkgName}`;
  }

  const startTime = Date.now();
  const id = `${pkgName}-${startTime}`;

  let npmUrl = "http://localhost:4873";
  // npmUrl = "https://npme.walmart.com";
  let pkgUrl = `${npmUrl}/${encodeURIComponent(pkgPath)}/-/${encodeURIComponent(pkgTgzFile)}`;
  const promise = new Promise((resolve, reject) => {
    const stream = Fs.createWriteStream(Path.resolve("tgz", pkgTgzFile));
    request(pkgUrl).on("response", resp => resolve({ resp, stream })).on("error", reject).pipe(stream);
  })
    .then(result => {
      const resp = result.resp;
      const stream = result.stream;
      // console.log("response code", resp.statusCode);
      if (resp.statusCode === 200) {
        return new Promise((resolve, reject) => {
          let closed;
          let finish;
          const close = () => {
            clearTimeout(finish);
            if (closed) return;
            closed = true;
            const elapse = Date.now() - startTime;
            console.log(`fetch ${pkgName} result ${resp.statusCode} time: ${elapse / 1000}sec`);
            resolve(true);
          };
          stream.on("finish", () => (finish = setTimeout(close, 1000)));
          stream.on("error", reject);
          stream.on("close", close);
        });
      }
      console.log(`fetch ${pkgName} response error`, resp.statusCode);
      return false;
    })
    .then(() => handleQueueItemDone(null, id))
    .catch(err => {
      console.log(`fetch '${pkgName}' failed`, err);
      handleQueueItemDone(err, id);
    });

  fetchingPromises[id] = { promise, pkgUrl, startTime };
}

const concurrency = 15;

for (let i = 0; i < concurrency; i++) {
  queueFetch(ud.shift());
}

//  http  --> 200, req: 'GET https://npme.walmart.com/%40walmart%2Fauth-plugin', bytes: 0/3008
