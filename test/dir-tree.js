"use strict";

// const _ = require("lodash");
const Path = require("path");
const Fs = require("fs");
const Yaml = require("js-yaml");

function readJson(file) {
  return JSON.parse(Fs.readFileSync(file).toString());
}

function readPackage(file) {
  const pkg = readJson(file);
  // const deps = Object.assign({}, pkg.peerDependencies, pkg.optionalDependencies, pkg.dependencies);
  // const res = {};

  // Object.keys(pkg._depResolutions).forEach(depName => {
  //   const dr = pkg._depResolutions[depName];
  //   const semv = deps[depName] || `undefined`;
  //   const depKey = `${dr.type}(${depName}@${semv})`;
  //   res[depKey] = dr.resolved || "undefined";
  //   delete deps[depName];
  // });

  const data = {
    id: pkg._id || `[${pkg.name}@${pkg.version}]`
    // res
  };

  // if (!_.isEmpty(deps)) {
  //   data.unres = deps;
  // }

  return data;
}

function dirTree(parent, dir, name) {
  const meDir = Path.join(dir, name);
  const files = Fs.readdirSync(meDir);
  const me = {};
  parent[name] = me;

  for (const f of files) {
    const meFile = Path.join(meDir, f);
    const stat = Fs.lstatSync(meFile);
    if (stat.isDirectory()) {
      dirTree(me, meDir, f);
    } else if (stat.isSymbolicLink()) {
      const target = Fs.readlinkSync(meFile);
      me[f] = `-> ${target}`;
    } else if (stat.isFile()) {
      if (f === "package.json") {
        me[f] = readPackage(meFile);
      } else {
        me[f] = "file";
      }
    } else if (stat.isBlockDevice()) {
      me[f] = "block_dev";
    } else if (stat.isCharacterDevice()) {
      me[f] = "char_dev";
    } else if (stat.isFIFO()) {
      me[f] = "fifo";
    } else if (stat.isSocket()) {
      me[f] = "socket";
    } else {
      me[f] = "???";
    }
  }

  return parent;
}

module.exports = {
  make: (dir, name) => {
    return dirTree({}, dir, name);
  }
};

if (require.main === module) {
  const tree = dirTree({}, process.cwd(), "node_modules");
  console.log(Yaml.dump(tree));
}
