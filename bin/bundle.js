var maj = parseInt(process.versions.node.split(".")[0], 10);
var bundle;

if (maj >= 8) {
  bundle = "../dist/fyn.js";
} else if (maj < 6) {
  console.log("Sorry, node version below 6 is not supported.  Your version is", maj);
  process.exit(1);
} else {
  bundle = "../dist/node6-fyn.js";
}

module.exports = bundle;
