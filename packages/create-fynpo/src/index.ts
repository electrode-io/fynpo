/* eslint-disable @typescript-eslint/no-var-requires*/
import { create } from "./create";
const NixClap = require("nix-clap");

const nixClap = new NixClap({
  usage: "$0 [command] [options]",
}).init(
  {
    commitlint: {
      type: "boolean",
      default: true,
      desc: "no-commitlint to skip commitlint configuration",
    },
  },
  {
    fynpo: {
      exec: create,
      args: "[dir]",
      desc: "Create a new fynpo monorepo",
    },
  }
);

function start() {
  if (process.argv.length > 2) {
    // if command is not recognize, then default to fynpo and use it as dir arg
    if (!["fynpo"].includes(process.argv[2])) {
      const argv = [].concat(process.argv.slice(0, 2), "fynpo", process.argv.slice(2));
      return nixClap.parse(argv, 2);
    }
  }
  return nixClap.parse();
}

start();
