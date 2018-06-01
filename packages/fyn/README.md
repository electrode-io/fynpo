[![NPM version][npm-image]][npm-url]
[![Apache 2.0 License][apache-2.0-blue-image]][apache-2.0-url]
[![Build Status][travis-image]][travis-url]
[![Dependency Status][daviddm-image]][daviddm-url] [![devDependency Status][daviddm-dev-image]][daviddm-dev-url]

# fyn

`fyn` is the result of a long pursuit for an easier workflow when developing over multiple node modules locally. It offers a simple way to develop and test across multiple modules effortlessly.

Over the course of realizing this goal, `fyn` gradually became a fully functional and super fast node package manager for the [flat node_modules design] that maintains [100% compatibility](#fyn-compatibility).

As a package manager, it employs a different approach that installs only one copy of every required versions of a package in a flat node_modules structure. Hence the name `fyn`, which stands for Flatten Your Node_modules.

At the top level, it installs a chosen version of each package. All other versions are installed under the directory `node_modules/__fv_/<version>/<package_name>`.

When necessary, packages have their own `node_modules` with symlinks/junctions inside pointing to dependencies inside `__fv_`.

![fyn demo][fyn-demo-gif]

# Features

* As its primary goal: effortlessly develop and test changes across multiple modules locally. (with [flat-module])

As a node package manager:

* Dependencies retained and checked at runtime. (with [flat-module])
* Your application will not silently load bad dependencies. (with [flat-module])
* A single copy of each installed packages.
* Always deterministic node_modules installation.
* Super fast performance. (faster than npm@5 and yarn, and even pnpm in some cases)
* Clean and flexible dependency locking.
* Detailed stats of your dependencies.
* Incremental install - add and remove dependencies in a deterministic fashion.
* Proper handling of `optionalDependencies`.

# Table Of Contents

* [Overview](#overview)
  * [Enhanced Local Modules Development](#enhanced-local-modules-development)
  * [Package Resolution and Layout](#package-resolution-and-layout)
* [Install](#install)
* [Using fyn](#using-fyn)
* [Configuring fyn](#configuring-fyn)
* [fyn Compatibility](#fyn-compatibility)
* [Using flat-module](#using-flat-module)
  * [Requirements](#requirements)
  * [`flat-module` Compatibility](#flat-module-compatibility)
  * [Preserving Symlinks](#preserving-symlinks)
  * [Setup flat-module](#setup-flat-module)
    * [Unix with `bash`](#unix-with-bash)
    * [Windows](#windows)
    * [Node 6 and lower](#node-6-and-lower)

# Overview

## Enhanced Local Modules Development

What is this? Think `npm link`, but better. `fyn` subjects local packages to the same dependency resolution logic as those from the npm registry. Then with [flat-module], you can test changes to any module locally as if they were published.

To enable, use the path to your local modules as semver in your package.json, or you can use the `fyn add` command.

For example:

```bash
fyn add ../my-awesome-module
```

That will install `my-awesome-module` into your node_modules. You can continue to develop and test `my-awesome-module` in its own directory and have the changes reflected in your app directly. Unlike `npm link`, your app resolves dependencies for `my-awesome-module` instead of relying on having them installed under `my-awesome-module/node_modules`.

See [using flat-module](#using-flat-module) if you are interested in trying it out.

## Package Resolution and Layout

As a package manager, the top level `node_modules` installed by `fyn` is a flat list of all the modules your application needs. It's easier to view and smaller in size. Extra versions of a module will be installed under a directory `__fv_`, and linked through symlinks or [flat-module].

`fyn` has an asynchronous and concurrent dependency resolution engine that is 100% compatible with node's nesting design, and properly handles `optionalDependencies`.

# Install

Please install `fyn` to your NodeJS setup globally.

```bash
npm install -g fyn
```

# Using fyn

Change into the directory for your project with the `package.json` file, and run:

```bash
fyn install
```

Depending on the size of your dependencies and your network speed, this could take anywhere from a few seconds to a few minutes.

# Configuring fyn

fyn options can be listed in help:

```bash
fyn --help
```

fyn loads config from `CWD/.fynrc`, `CWD/.npmrc`, `~/.fynrc`, and `~/.npmrc` in this specified order, from highest to lowest priority.

From `.npmrc`, only fields `registry`, `email`, and `_auth` are read.

`.fynrc` file can be an [ini] or `YAML` format. For the `YAML` format, the first line must be `---`.

Below is an `YAML` example, with all the options set to their default values:

```yaml
---
registry: https://registry.npmjs.org
localOnly: false
forceCache: false
lockOnly: false
progress: normal
logLevel: info
production: false
```

Or as an ini:

```ini
registry=https://registry.npmjs.org
localOnly=false
forceCache=false
lockOnly=false
progress=normal
logLevel=info
production=false
```

> Any command line option can be converted to an option in the RC file by changing the name to camelCase form.

If there's no RC file or command line override, then these defaults are used:

* `registry` - `https://registry.npmjs.org`
* `progress` - `normal`
* `logLevel` - `info`

# fyn Compatibility

* `fyn`'s top level `node_modules` is 100% compatible with NodeJS and 3rd party tools and modules.

* The way `fyn` uses symlinks to resolve nested dependencies is also fully compatible with NodeJS. The only caveat is NodeJS module loader always resolve a package's path to its real path.

  For example, if `A` depends on `B@1.0.0` that's not at the top level, then `node_modules/A/node_modules/B` is a symlink to `node_modules/B/__fv_/1.0.0/B`.

  Without preserve symlinks, `B`'s path would be resolved to the real path `node_modules/B/__fv_/1.0.0/B`, instead of the symlink path `node_modules/A/node_modules/B`.

  If you want to keep the symlink path, then set the environment variable [NODE_PRESERVE_SYMLINKS] to `1`. It doesn't affect normal operations either way unless you have code that explicitly depend on the path, which should be avoided. The subtle difference is that with preserve symlink, each symlink path of the same module will be loaded as its own instance by Node's module system.

* `fyn` can't handle npm's `npm-shrinkwrap.json` and `package-lock.json` files.

# Using flat-module

`fyn` is designed to work with [flat-module] to unlock some enhanced features that improve the NodeJS module development workflow.

The original intent of [flat-module] was to improve the workflow of `npm link` when doing local module development. `fyn` installs modules from your local file system like it's a real dependency from the npm registry and requires the [flat-module] support to work properly.

## Requirements

[flat-module] support has to be loaded when node starts up.

For NodeJS 8, set the `--require` option in [NODE_OPTIONS] env.

For NodeJS 6, you have to explicitly specify the `--require` option when invoking node. Note that child processes wouldn't inherit this value.

## `flat-module` Compatibility

The `flat-module` extension is 100% compatible and co-exist with Node's nesting module system.

If you need to resolve the location of a package, the recommended approach is to use `require.resolve`. If you need to do that for a package within the context of a specific directory, then the recommended way is to use [require-at].

## Preserving Symlinks

Due to NodeJS resolving module paths to their real paths, a symlinked package's path ends up not being part of your `node_modules`.

If you want all paths to appear within your application's directory, set [NODE_PRESERVE_SYMLINKS] to `1`, which [flat-module] is designed to work well with.

## Setup flat-module

### Unix with `bash`

If you are using bash, to setup the [NODE_OPTIONS] env for [flat-module], you have two options:

1.  Use `eval` for bash:

```bash
eval `fyn bash`
```

2.  Set it up manually:

```bash
export NODE_OPTIONS="-r <path-to-flat-module>"
```

You can find `<path-to-flat-module>` with this command:

```bash
fyn fm
```

> If you use another shell other than bash, please check its docs for instructions on how to set environment variables.

### Windows

On Windows, you have two options:

1.  Run `fyn win` to generate a batch file `fynwin.cmd` in your current directory. Invoke `fynwin.cmd` to setup [NODE_OPTIONS]. The file will delete itself.

```batch
fyn win && fynwin
```

2.  Run the following command yourself:

```batch
set NODE_OPTIONS=-r <path-to-flat-module>
```

> Suggestions for a better method to setup on Windows are welcomed.

### Node 6 and lower

Only Node 8 and up supports [NODE_OPTIONS].

For Node 4 and 6, you have to specify the [`-r` option] when you invoke node, like this:

```
node -r <path-to-flat-module>
```

However, [flat-module] doesn't really work well even with this, because child process spawn from Node will not inherit that option.

# License

Copyright (c) 2015-present, WalmartLabs

Licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).

[flat-module]: https://github.com/jchip/node-flat-module
[flat node_modules design]: https://github.com/jchip/node-flat-module
[node_options]: https://nodejs.org/dist/latest-v8.x/docs/api/cli.html#cli_node_options_options
[`-r` option]: https://nodejs.org/docs/latest-v6.x/api/cli.html#cli_r_require_module
[fyn-demo-gif]: ./images/fyn-demo.gif
[ini]: https://www.npmjs.com/package/ini
[node_preserve_symlinks]: https://nodejs.org/docs/latest-v8.x/api/cli.html#cli_node_preserve_symlinks_1
[require-at]: https://www.npmjs.com/package/require-at
[travis-image]: https://travis-ci.org/jchip/fyn.svg?branch=master
[travis-url]: https://travis-ci.org/jchip/fyn
[npm-image]: https://badge.fury.io/js/fyn.svg
[npm-url]: https://npmjs.org/package/fyn
[daviddm-image]: https://david-dm.org/jchip/fyn/status.svg
[daviddm-url]: https://david-dm.org/jchip/fyn
[daviddm-dev-image]: https://david-dm.org/jchip/fyn/dev-status.svg
[daviddm-dev-url]: https://david-dm.org/jchip/fyn?type=dev
[apache-2.0-blue-image]: https://img.shields.io/badge/License-Apache%202.0-blue.svg
[apache-2.0-url]: https://www.apache.org/licenses/LICENSE-2.0
[npm scripts]: https://docs.npmjs.com/misc/scripts
