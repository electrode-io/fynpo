"use strict";
const Fs = require("fs");
const pkg = JSON.parse(Fs.readFileSync("pkg.json"));
const Promise = require("bluebird");
const _ = require("lodash");
const Fetch = require("node-fetch");
Fetch.Promise = Promise;
const ElectrodeKeepAlive = require("electrode-keepalive");

//console.log(pkg);

const dependencies = Object.keys(pkg.dependencies); // .concat(pkg.devDependencies);

const ud = _.uniq(dependencies);

const meta = {};


const opts = {
  keepAlive: true,
  keepAliveMsecs: 30000, // socket send keep alive ping every 30 secs
  maxSockets: 100,
  maxFreeSockets: 10,
  https: false
};

const keepAlive = new ElectrodeKeepAlive(opts);

const dnsOptions = {};

async function fetchMeta(data) {
  const output = {};
  await Promise.map(data.dependencies, async(item, index, len) => {
    if (data.meta[item]) {
      return true;
    }

    await new Promise((resolve, reject) => {
      keepAlive.preLookup("localhost", dnsOptions, (err) => {
        return err ? reject(err) : resolve();
      });
    });

    const resp = await Fetch(`http://localhost:4873/${encodeURIComponent(item)}`, {
      redirect: "manual",
      //      timeout: 30000,
      compress: true,
      agent: keepAlive.agent
    });

    if (resp.status === 200) {
      const body = await resp.text();
      console.log(`fetch ${item} result ${resp.status} ${typeof body}`);
      data.meta[item] = JSON.parse(body);
      return true;
    }

    return false;
  }, {concurrency: 30});
  console.log("done");
  return output;
}

async function fetch() {
  try {
    await fetchMeta({dependencies: ud, meta});
  } catch (e) {
    console.log("fetch failed", e);
  }
}

fetch();


//  http  --> 200, req: 'GET https://npme.walmart.com/%40walmart%2Fauth-plugin', bytes: 0/3008
