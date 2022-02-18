"use strict";

const Path = require("path");
const webpack = require("webpack");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

const base = {
  mode: "production",
  // devtool: "source-map",
  entry: {
    "index.js": Path.resolve("src/index.ts"),
  },
  optimization: {
    minimize: false,
    concatenateModules: false,
    mangleExports: false,
    mergeDuplicateChunks: true,
    innerGraph: false,
    chunkIds: "named",
    moduleIds: "named",
    nodeEnv: "production",
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true,
    }),
    process.env.ANALYZE_BUNDLE && new BundleAnalyzerPlugin(),
  ].filter((x) => x),
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
      lodash$: require.resolve("lodash/lodash.min.js"),
      "resolve-from": Path.resolve("stubs/resolve-from.js"),
      "@commitlint/resolve-extends": Path.resolve("stubs/resolve-extends.js"),
      "./parser-flow.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-typescript.js": Path.resolve("stubs/parser-typescript.js"),
      "./third-party.js": Path.resolve("stubs/parser-typescript.js"),
      "./parser-angular.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-babel.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-espree.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-glimmer.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-graphql.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-html.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-markdown.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-meriyah.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-postcss.js": Path.resolve("stubs/parser-flow.js"),
      "./parser-yaml.js": Path.resolve("stubs/parser-flow.js"),
      "util/types": Path.resolve("stubs/util-types.js"),
    },
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: `[name]`,
    path: Path.resolve("dist"),
    libraryTarget: "commonjs2",
  },
  target: "node",
  node: {
    __filename: false,
    __dirname: false,
  },
  externals: {
    "fyn/package.json": "fyn/package.json",
    "fyn/bin": "fyn/bin",
    fyn: "fyn",
    // prettier: "prettier",
    "resolve-global": "resolve-global",
    "global-dirs": "global-dirs",
    callsites: "callsites",
    "resolve-from": "resolve-from",
    // "@commitlint/resolve-extends": "@commitlint/resolve-extends",
    "import-fresh": "import-fresh",
    // lodash: "lodash",
    "parent-module": "parent-module",
    ini: "ini",
  },
};

const node8 = Object.assign({}, base, {
  module: {
    rules: [
      {
        test: /\.[jt]s$/,
        // ensure all code are transpiled, in case a module we use no longer supports node 8.0
        exclude: (file) => {
          return file.includes("node_modules") && file.includes("prettier");
        },
        use: {
          loader: "babel-loader",
          options: {
            presets: [["@babel/env", { targets: { node: "8" } }], "@babel/preset-typescript"],
          },
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
          requireJs: false, // disable requirejs.*
          // node: false, // disable __dirname, __filename, module, require.extensions, require.main, etc.
          // commonjsMagicComments: false // disable magic comments support for CommonJS
          // node: {...}, // reconfigure [node](/configuration/node) layer on module level
          // worker: ["default from web-worker", "..."] // Customize the WebWorker handling for javascript files, "..." refers to the defaults.
        },
      },
    ],
  },
});

module.exports = [node8];
