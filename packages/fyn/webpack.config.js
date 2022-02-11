"use strict";

const Path = require("path");
const webpack = require("webpack");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

const base = {
  mode: "production",
  // devtool: "source-map",
  entry: {
    "fyn.js": Path.resolve("cli/main.js")
  },
  optimization: {
    minimize: false,
    concatenateModules: false,
    mangleExports: false,
    mergeDuplicateChunks: true,
    innerGraph: false,
    chunkIds: "named",
    moduleIds: "named",
    nodeEnv: "production"
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
      // Even if fyn's code import lodash APIs like lodash/get,
      // other modules could be importing it whole, so it's better
      // to just load it, and override it with the minified copy
      // when bundling.
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
        },
        parser: {
          amd: false, // disable AMD
          // commonjs: false, // disable CommonJS
          system: false, // disable SystemJS
          // harmony: false, // disable ES2015 Harmony import/export
          requireInclude: false, // disable require.include
          requireEnsure: false, // disable require.ensure
          requireContext: false, // disable require.context
          browserify: false, // disable special handling of Browserify bundles
          requireJs: false // disable requirejs.*
          // node: false, // disable __dirname, __filename, module, require.extensions, require.main, etc.
          // commonjsMagicComments: false // disable magic comments support for CommonJS
          // node: {...}, // reconfigure [node](/configuration/node) layer on module level
          // worker: ["default from web-worker", "..."] // Customize the WebWorker handling for javascript files, "..." refers to the defaults.
        }
      },
      {
        // skip node-gyp/lib/Find-VisualStudiio.cs
        test: /\.cs$/,
        use: "null-loader"
      }
    ]
  }
});

module.exports = [node8];
