"use strict";

const Path = require("path");
const webpack = require("webpack");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

const base = {
  mode: "development",
  // devtool: "source-map",
  entry: {
    "fyn.js": Path.resolve("cli/main.js")
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true
    }),
    process.env.ANALYZE_BUNDLE && new BundleAnalyzerPlugin()
  ].filter(x => x),
  resolve: {
    symlinks: true, // resolve symlinks to their real path
    alias: {
      xml2js: Path.resolve("stubs/xml2js.js"),
      "iconv-lite": Path.resolve("stubs/iconv-lite.js"),
      "./iconv-loader": Path.resolve("stubs/iconv-loader.js"),
      debug: Path.resolve("stubs/debug.js"),
      lodash: require.resolve("lodash/lodash.min.js"),
      "resolve-from": Path.resolve("stubs/resolve-from.js")
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

const node8 = Object.assign({}, base, {
  module: {
    rules: [
      {
        test: /\.js$/,
        // ensure all code are transpiled, in case a module we use no longer supports node 8.0
        exclude: () => false,
        use: {
          loader: "babel-loader",
          options: {
            presets: [["@babel/env", { targets: { node: "8" } }]]
          }
        }
      }
    ]
  }
});

module.exports = [node8];
