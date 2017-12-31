"use strict";

const Path = require("path");
const webpack = require("webpack");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

module.exports = {
  //devtool: "source-map",
  entry: {
    "fyn.js": Path.resolve("cli/fyn.js")
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true
    }),
    process.env.ANALYZE_BUNDLE && new BundleAnalyzerPlugin()
  ].filter(x => x),
  resolve: {
    alias: {
      xml2js: Path.resolve("stubs/xml2js.js"),
      "iconv-lite": Path.resolve("stubs/iconv-lite.js"),
      debug: Path.resolve("stubs/debug.js"),
      lodash: require.resolve("lodash/lodash.min.js")
    }
  },
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
