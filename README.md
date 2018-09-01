[![NPM version][npm-image]][npm-url]
[![Apache 2.0 License][apache-2.0-blue-image]][apache-2.0-url]
[![Build Status][travis-image]][travis-url]
[![Dependency Status][daviddm-image]][daviddm-url] [![devDependency Status][daviddm-dev-image]][daviddm-dev-url]

# fyn - Node Module Development Made Easy

`fyn` is the result of a long pursuit for an easier workflow when developing over multiple node modules locally. It offers a simple way to develop and test across multiple modules effortlessly.

Over the course of realizing this goal, `fyn` gradually became a fully functional and super fast node package manager for the [flat node_modules design] that maintains [100% compatibility](#fyn-compatibility).

As a package manager, it employs a different approach that installs only one copy of every required versions of a package in a flat node_modules structure. Hence the name `fyn`, which stands for Flatten Your Node_modules.

At the top level, it installs a chosen version of each package. All other versions are installed under the directory `node_modules/__fv_/<version>/<package_name>`.

When necessary, packages have their own `node_modules` with symlinks/junctions inside pointing to dependencies inside `__fv_`.

See [features](#features) for its key benefits.

![fyn demo][fyn-demo-gif]

# Features

- Designed for easy module development.
- Smallest `node_modules`: only a single copy of each installed packages.
- Always deterministic `node_modules` installation.
- Super fast performance.
- Clean and flexible dependency locking.
- Detailed stats of your dependencies.
- Proper handling of `optionalDependencies`.
- 100% compatible with NodeJS and its eCosystem.

# Table Of Contents

- [Thank you `npm`](#thank-you-npm)
- [Overview](#overview)
  - [Enhanced Local Modules Development](#enhanced-local-modules-development)
  - [Package Resolution and Layout](#package-resolution-and-layout)
- [Install](#install)
- [Using fyn](#using-fyn)
- [Configuring fyn](#configuring-fyn)
  - [Command Line Option to RC Mapping](#command-line-option-to-rc-mapping)
  - [Other RC Options](#other-rc-options)
    - [Scope registry](#scope-registry)
- [Compatibility](#compatibility)
- [License](#license)

# Thank you `npm`

Node Package Manager is a very large and complex piece of software. Because of the generous open source software from the community, especially the individual packages that are part of `npm`, `fyn` was probably 10 times less work than what it would've been.

Other than benefiting from the massive package ecosystem and all the documents from `npm`, these are the concrete packages from `npm` that `fyn` is using directly.

- [node-tar] - for untaring `tgz` files.
- [semver] - for handling Semver versions.
- [pacote] - for retrieving `npm` package data.
- [ini] - for handling `ini` config files.
- [npm-packlist] - for filtering files according to npm ignore rules.
- And all the other packages they depend on.

# Overview

## Enhanced Local Modules Development

What is this? Think `npm link`, but better. `fyn` subjects local packages to the same dependency resolution logic as those from the npm registry. Then you can test changes to any module locally as if they were published.

To enable, use the path to your local modules as semver in your package.json, or you can use the `fyn add` command.

For example:

```bash
fyn add ../my-awesome-module
```

That will install `my-awesome-module` into your node_modules. You can continue to develop and test `my-awesome-module` in its own directory and have the changes within existing files reflected in your app directly. Unlike `npm link`, your app resolves dependencies for `my-awesome-module` instead of relying on having them installed under `my-awesome-module/node_modules`.

If you add/remove files/directories in your local package, then running `fyn` install would take only seconds to update.

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

From `.npmrc`, only fields `registry`, `@<scope>:registry`,`email`, and `_auth` are read.

`.fynrc` file can be an [ini] or `YAML` format. For the `YAML` format, the first line must be `---`.

Below is an `YAML` example, with all the options set to their default values:

```yaml
---
registry: https://registry.npmjs.org
"@scope:registry": https://registry.custom.com
offline: false
forceCache: false
lockOnly: false
progress: normal
logLevel: info
production: false
```

Or as an ini:

```ini
registry=https://registry.npmjs.org
@scope:registry=https://registry.custom.com
offline=false
forceCache=false
lockOnly=false
progress=normal
logLevel=info
production=false
```

## Command Line Option to RC Mapping

> Any command line option can be converted to an option in the RC file by changing the name to camelCase form.

If there's no RC file or command line override, then these defaults are used:

- `registry` - `https://registry.npmjs.org`
- `progress` - `normal`
- `logLevel` - `info`

## Other RC Options

### Scope registry

Scope registry can be specified in the RC files, the same as `.npmrc`.

For example, in Yaml format:

```yaml
---
"@scope:registry": https://registry.custom.com
```

In ini format:

```ini
@scope:registry=https://registry.custom.com
```

# Compatibility

- `fyn`'s top level `node_modules` is 100% compatible with NodeJS and 3rd party tools and modules.

- `fyn` uses npm's [pacote] to do data retrieval. That means its package data handling is the same as npm and it can use npm's cache directly.

- The way `fyn` uses symlinks to resolve nested dependencies is also fully compatible with NodeJS. The only caveat is NodeJS module loader always resolve a package's path to its real path.

  For example, if `A` depends on `B@1.0.0` that's not at the top level, then `node_modules/A/node_modules/B` is a symlink to `node_modules/B/__fv_/1.0.0/B`.

  Without preserve symlinks, `B`'s path would be resolved to the real path `node_modules/B/__fv_/1.0.0/B`, instead of the symlink path `node_modules/A/node_modules/B`.

  If you want to keep the symlink path, then set the environment variable [NODE_PRESERVE_SYMLINKS] to `1`. It doesn't affect normal operations either way unless you have code that explicitly depend on the path, which should be avoided. The subtle difference is that with preserve symlink, each symlink path of the same module will be loaded as its own instance by Node's module system.

- `fyn` can't handle npm's `npm-shrinkwrap.json` and `package-lock.json` files.

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
[node-tar]: https://www.npmjs.com/package/tar
[semver]: https://www.npmjs.com/package/semver
[pacote]: https://www.npmjs.com/package/pacote
[ini]: https://www.npmjs.com/package/ini
[npm-packlist]: https://www.npmjs.com/package/npm-packlist
