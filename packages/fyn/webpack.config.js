"use strict";

const Path = require("path");
const webpack = require("webpack");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

const base = {
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
    symlinks: false, // don't resolve symlinks to their real path
    alias: {
      xml2js: Path.resolve("stubs/xml2js.js"),
      "iconv-lite": Path.resolve("stubs/iconv-lite.js"),
      "./iconv-loader": Path.resolve("stubs/iconv-loader.js"),
      debug: Path.resolve("stubs/debug.js"),
      lodash: require.resolve("lodash/lodash.min.js")
    }
  },
  output: {
    filename: `[name]`,
    path: Path.resolve("dist"),
    libraryTarget: "commonjs2"
  },
  target: "node",
  node: {
    __filename: false,
    __dirname: false
  }
};

const node6 = Object.assign({}, base, {
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: x => x.indexOf("node_modules") > 0,
        use: "babel-loader"
      }
    ]
  },
  output: {
    filename: `node6-[name]`,
    path: Path.resolve("dist"),
    libraryTarget: "commonjs2"
  }
});

module.exports = [base, node6];
