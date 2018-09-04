[![NPM version][npm-image]][npm-url]
[![Apache 2.0 License][apache-2.0-blue-image]][apache-2.0-url]
[![Build Status][travis-image]][travis-url]
[![Dependency Status][daviddm-image]][daviddm-url] [![devDependency Status][daviddm-dev-image]][daviddm-dev-url]

# fyn - Node Module Development Made Easy

`fyn` is the result of a long pursuit for an easier workflow when developing over multiple node modules locally. It offers a simple way to develop and test across multiple modules effortlessly.

Over the course of realizing this goal, `fyn` gradually became a fully functional and super fast node package manager for the [flat node_modules design] that maintains [100% compatibility](#compatibility).

As a package manager, it employs a different approach that installs only one copy of every required versions of a package in a flat node_modules structure. Hence the name `fyn`, which stands for Flatten Your Node_modules.

At the top level, it installs a chosen version of each package. All other versions are installed under the directory `node_modules/__fv_/<version>/<package_name>`.

When necessary, packages have their own `node_modules` with symlinks/junctions inside pointing to dependencies inside `__fv_`.

See [features](#features) for its key benefits.

![fyn demo][fyn-demo-gif]

# Table Of Contents

- [Features](#features)
- [Thank you `npm`](#thank-you-npm)
- [Overview](#overview)
  - [Enhanced Local Modules Development](#enhanced-local-modules-development)
    - [`fyn` Local Linking Install](#fyn-local-linking-install)
    - [Easier Debugging `node_modules`](#easier-debugging-node_modules)
  - [Package Resolution and Layout](#package-resolution-and-layout)
- [Install](#install)
- [Using fyn](#using-fyn)
- [Configuring fyn](#configuring-fyn)
  - [Command Line Option to RC Mapping](#command-line-option-to-rc-mapping)
  - [Other RC Options](#other-rc-options)
    - [Scope registry](#scope-registry)
  - [Central Storage](#central-storage)
- [Compatibility](#compatibility)
- [Using with Lerna](#using-with-lerna)
- [License](#license)

# Features

- A super fast node package manager for installing modules.
- Designed for easy module development.
- 100% compatible with NodeJS and its ecosystem.
- Smallest `node_modules` size possible.
- Clean and flexible dependency locking.
- Always deterministic `node_modules` installation.
- Show detailed stats of your dependencies.
- Proper handling of `optionalDependencies`.
- Keeping compatibility by internally using the same modules as [npm].
- Efficient disk space usage with optional [central storage](#central-storage).
- Works particularly well with [lerna] monorepos.

# Thank you `npm`

Node Package Manager is a very large and complex piece of software. Developing `fyn` was 10 times easier because of the generous open source software from the community, especially the individual packages that are part of `npm`.

Other than benefiting from the massive package ecosystem and all the documents from `npm`, these are the concrete packages from `npm` that `fyn` is using directly.

- [node-tar] - for untaring `tgz` files.
- [semver] - for handling Semver versions.
- [pacote] - for retrieving `npm` package data.
- [ini] - for handling `ini` config files.
- [npm-packlist] - for filtering files according to npm ignore rules.
- And all the other packages they depend on.

# Overview

## Enhanced Local Modules Development

- Have you ever need to set a breakpoint in a module within `node_modules`?

- Maybe you need to make some changes in some code in `node_modules` and test, but then you have to copy them out if you want to keep your changes.

With `fyn`, it comes with features specifically designed to make your "debugging" `node_modules` easier.

### `fyn` Local Linking Install

What is this? Think `npm link`, but better. `fyn` subjects local packages to the same dependency resolution logic as those from the npm registry. Then you can test changes to any module locally as if they were published.

To enable, use the path to your local modules as semver in your package.json, or you can use the `fyn add` command.

For example:

```bash
fyn add ../my-awesome-module
```

That will install `my-awesome-module` into your node_modules. You can continue to develop and test `my-awesome-module` in its own directory and have the changes within existing files reflected in your app directly. Unlike `npm link`, your app resolves dependencies for `my-awesome-module` instead of relying on having them installed under `my-awesome-module/node_modules`.

If you add/remove files/directories in your local package, then running `fyn` install would take only seconds to update.

### Easier Debugging `node_modules`

`node_modules` installed by [npm] could potentially have multiple copies of the same version of a package. So even if you've identified the module that you think could help you debug your problem, you may still need to deal with multiple copies of the same version.

With `fyn`'s flat `node_modules` design, there is only one copy of any version so it's easier for you to set your breakpoint. Of course you still have to figure out which version if there are multiple versions of a package though.

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

```yml
---
registry: https://registry.npmjs.org
"@scope:registry": https://registry.custom.com
offline: false
forceCache: false
lockOnly: false
progress: normal
logLevel: info
production: false
centralStore: false
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
centralStore=false
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

```yml
---
"@scope:registry": https://registry.custom.com
```

In ini format:

```ini
@scope:registry=https://registry.custom.com
```

## Central Storage

Inspired by [pnpm], `fyn` supports storing a single copy of all packages at a central location, and use hardlinks to install them into your `node_modules`.

The main advantage of this is to save disk space and slightly faster install if the storage is primed.

However, this feature is not enabled by default due to the following drawbacks:

1. Creating hardlinks actually could take a lot more than trivial time.

   - What this means is the first time you install with `fyn`, when nothing is cached in the storage, central store mode will actually take noticeably more time, but subsequent installs could be faster.

   - In particular, very bad on MacOS (High Sierra). For example, using hardlinks to replicate the module `nyc` actually takes longer than untaring the tgz file. It improves somewhat with concurrency, but still significant.

   - On Linux with ext4 hardlinking appears to be more than 10 times more efficient than MacOS.

2. You can't do your debugging and development by modifying code that's installed into `node_modules` directly.

   - Reason being that any change you make will affect the central copy, and therefore any other `node_modules` that's linked to it.

   - If you do this, then even after you blow away your `node_modules` and reinstall it, your "debugging" changes will be there again.

   - I imagine that this is actually a fairly big drawback for a lot of people.

   - However, the primary design goal of `fyn` is to make your module development easier with its local linking install feature. You should use that to develop and debug multiple modules locally.

3. Similar to 2, but if any package has `postinstall` script that modifies its own files, then those modifications would affect all installations.

   - There should not be a lot of packages like this, but if you happen to use one, it's unlikely a central storage would work.

If you don't mind these drawbacks and you want to use this feature, then you can enable it with the `--central-store` CLI option.

The recommendation is to add the following to `.fynrc` because then you don't have to remember to specify the option in the CLI every time.

```ini
centralStore=true
```

# Compatibility

- `fyn`'s top level `node_modules` is 100% compatible with NodeJS and 3rd party tools and modules. No special updates or changes needed.

- `fyn` uses npm's [pacote] to do data retrieval. That means its package data handling is the same as npm and it can use npm's cache directly.

- The way `fyn` uses symlinks to resolve nested dependencies is also fully compatible with NodeJS. The only caveat is NodeJS module loader always resolve a package's path to its real path.

  For example, if `A` depends on `B@1.0.0` that's not at the top level, then `node_modules/A/node_modules/B` is a symlink to `node_modules/B/__fv_/1.0.0/B`.

  Without preserve symlinks, `B`'s path would be resolved to the real path `node_modules/B/__fv_/1.0.0/B`, instead of the symlink path `node_modules/A/node_modules/B`.

  If you want to keep the symlink path, then set the environment variable [NODE_PRESERVE_SYMLINKS] to `1`. It doesn't affect normal operations either way unless you have code that explicitly depend on the path, which should be avoided. The subtle difference is that with preserve symlink, each symlink path of the same module will be loaded as its own instance by Node's module system.

- `fyn` can't handle npm's `npm-shrinkwrap.json` and `package-lock.json` files.

# Using with Lerna

[lerna] actually implements its own internal `npm link` like feature to support a monorepo with packages that depend on each other.

I haven't been able to bootstrap my [lerna] monorepo with npm since version 5.

`fyn` works particularly well with a [lerna] monorepo, but of course since it offers an enhanced `npm link`, it replaces [lerna]'s bootstrap feature.

To bootstrap a [lerna] repo with `fyn`'s enhanced `npm link`, please use the module [fynpo].

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
[pnpm]: https://www.npmjs.com/package/pnpm
[npm]: https://www.npmjs.com/package/npm
[lerna]: https://www.npmjs.com/package/lerna
[fynpo]: https://www.npmjs.com/package/fynpo
