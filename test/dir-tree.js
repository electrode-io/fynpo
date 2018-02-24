const Path = require("path");
const Fs = require("fs");
const Yaml = require("js-yaml");

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
      me[f] = "file";
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
