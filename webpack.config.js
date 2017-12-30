"use strict";

const Path = require("path");
const webpack = require("webpack");

module.exports = {
  //devtool: "source-map",
  entry: {
    "fyn.js": Path.resolve("cli/fyn.js")
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true
    })
  ],
  output: {
    filename: `[name]`,
    path: Path.resolve("bin"),
    libraryTarget: "commonjs2"
  },
  target: "node",
  node: {
    __filename: false,
    __dirname: false
  }
};
