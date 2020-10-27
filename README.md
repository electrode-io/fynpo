# fyn

**A fast node package manager for better productivity and efficiency**

[![NPM version][npm-image]][npm-url]
[![Apache 2.0 License][apache-2.0-blue-image]][apache-2.0-url]
[![Build Status][travis-image]][travis-url]
[![Coverage Status][coveralls-image]][coveralls-url]
[![Dependency Status][daviddm-image]][daviddm-url] [![devDependency Status][daviddm-dev-image]][daviddm-dev-url]

`fyn` is a super fast node package manager with some unique features:

- enhanced [npm link] with [fynlocal mode](#fynlocal-mode)
- efficient disk space usage with [central storage](#central-storage)
- smaller `node_modules` with [guaranteed single copy of a package](#smaller-node_modules)
- flexible dependencies lock by using a [lock time stamp](#locking-dependencies-by-time)
- and [more](#features)

![fyn demo][fyn-demo-gif]

## Quick Start

Interested in giving it a quick test? Just install and run it on your project:

```sh
npm i -g fyn
cd <your-project>
fyn
```

- It can read and use some settings from your `.npmrc`.
- It can use `npm-shrinkwrap.json` or `package-lock.json` files.

## Table Of Contents

- [fyn](#fyn)
  - [Quick Start](#quick-start)
  - [Table Of Contents](#table-of-contents)
  - [Features](#features)
    - [Unique](#unique)
    - [General](#general)
  - [Overview](#overview)
  - [Rationale](#rationale)
  - [Enhanced `npm link`](#enhanced-npm-link)
    - [`fynlocal` mode](#fynlocal-mode)
  - [Smaller `node_modules`](#smaller-node_modules)
  - [Easier Debugging `node_modules`](#easier-debugging-node_modules)
  - [Using fyn](#using-fyn)
    - [Installing `fyn`](#installing-fyn)
    - [Installing Your Dependencies](#installing-your-dependencies)
    - [Running npm scripts](#running-npm-scripts)
    - [The `stat` command](#the-stat-command)
      - [Locking Dependencies by Time](#locking-dependencies-by-time)
    - [Refreshing Optional Dependencies](#refreshing-optional-dependencies)
      - [Using with Lerna](#using-with-lerna)
  - [Configuring fyn](#configuring-fyn)
    - [Command Line Option to RC Mapping](#command-line-option-to-rc-mapping)
    - [Other RC Options](#other-rc-options)
      - [Scope registry](#scope-registry)
    - [Central Storage](#central-storage)
  - [Other Info](#other-info)
    - [Compatibility](#compatibility)
    - [Package Resolution and Layout](#package-resolution-and-layout)
    - [Thank you `npm`](#thank-you-npm)
  - [License](#license)

## Features

### Unique

- Focus on improving workflow and productivity.
- Very comprehensive and proper handling of `optionalDependencies`.
- A new `devOptDependencies` allows optional `devDependencies`.
- [Guaranteed single copy of a package](#flatten-nodemodules) => smaller `node_modules`.
- The best at installing and linking local packages - better [npm link].
- Install local packages like they are published (`fynlocal` mode)
- Works particularly well with [lerna] monorepos.
- Shows detailed stats of your dependencies.
- Efficient disk space usage with optional [central storage](#central-storage).
- Central storage mode is fast (and very fast on Linux) once cache is hot.
- Install dependencies with a time stamp lock.

### General

- A super fast node package manager for installing modules.
- Production quality with a lot of unit tests and verified on real applications.
- 100% compatible with Node.js and its ecosystem.
- A flat and simple dependency lock file that can be diffed and edited.
- Always deterministic `node_modules` installation.
- Compatible with [npm] by internally using the same modules as [npm].
- Maintains as much of [npm]'s behaviors as possible.
- Able to use [npm]'s `npm-shrinkwrap.json` or `package-lock.json`.

## Overview

`fyn` is the result of a long pursuit to make developing and managing large and complex software in Node.js easier.
To realize that, it ultimately ends up being a node package manager.

It started out as small experiments for a single goal of better local package installing and linking, ie: better [npm link], but has gradually grown to a fully functional node package manager for the [flat node_modules design]. It is fast, production quality, and maintains [100% compatibility](#compatibility).

While it has all the bells and whistles to make it an extremely fast and efficient package manager, it's not just another [npm].

It comes with two unique features that are very useful when you are working on a large Node.js application that consists of many packages.

## Rationale

So why would you want to use this?

`fyn`'s `node_modules` structure is the smallest possible in size because there are no multiple copies of the exact same package installed.

It also has a special `fynlocal` mode that's a better [npm link] for handling local packages.

If your development in Node.js are typically simple and involves only a single module or small applications, then `fyn`'s advantage may not be apparent to you, but if your Node.js project is large and complex, then fyn may be helpful to you. Please read further to learn more.

## Enhanced `npm link`

`fyn` has a `fynlocal` mode that's designed specifically to be a much better [npm link]. It treats packages on your local disk like they've been published. You can install and use them directly, and quickly test changes iteratively. It would be very useful if you've ever done any of these:

- Debug your application by inspecting code inside `node_modules`.
- Live edit your package that's installed to `node_modules`, and then have to copy the changes out to commit.
- Use [lerna] to maintain and develop multiple packages. `fyn` works particularly well with a [lerna] repo.
- Or just have to juggle a lot of packages as part of your development.

### `fynlocal` mode

What is this? Think [npm link], but better. `fyn` subjects local packages to the same dependency resolution logic as those from the npm registry. Then you can test changes to any module locally as if they were published.

To enable, use the path to your local modules as semver in your package.json, or you can use the `fyn add` command.

For example:

```sh
fyn add ../my-awesome-module
```

That will install `my-awesome-module` into your node_modules. You can continue to develop and test `my-awesome-module` in its own directory and have the changes within existing files reflected in your app directly. Unlike `npm link`, your app resolves dependencies for `my-awesome-module` instead of relying on having them installed under `my-awesome-module/node_modules`.

If you add/remove files/directories in your local package, then running `fyn` install would take only seconds to update.

`fyn` will also save a file `package-fyn.json` with local dependencies in a section called `fyn`. You should not commit this file and `.gitignore` it. `fyn` will automatically check this file when installing, but you can turn off `fynlocal` mode with with the flag `--no-fynlocal` easily.

## Smaller `node_modules`

As a package manager, `fyn` employs a different approach that installs only one copy of every required versions of a package in a flat node_modules structure. Hence the name `fyn`, which stands for Flatten Your Node_modules.

At the top level, it installs a chosen version of each package. All other versions are installed under the directory `node_modules/__fv_/<version>/<package_name>`.

When necessary, packages have their own `node_modules` with symlinks/junctions inside pointing to dependencies under `__fv_`.

This approach has the benefit of guaranteeing a single copy of a package installed and therefore slightly smaller size `node_modules`.

## Easier Debugging `node_modules`

With a guaranteed single copy of a package, it makes debugging easier when you have to reach into code under `node_modules`.

`node_modules` installed by [npm] could potentially have multiple copies of an identical package. So even if you've identified the module under `node_modules` to investigate your issue, you may still need to figure which copy.

With `fyn`'s flat `node_modules` design, there is only one copy of any version so it's easier for you to set your breakpoint.

## Using fyn

### Installing `fyn`

Please install `fyn` to your Node.js setup globally.

```sh
npm install -g fyn
```

### Installing Your Dependencies

Change into the directory for your project with the `package.json` file, and run:

```sh
fyn
```

- Which is a shorthand for `fyn install` since `install` is the default command.

Depending on the size of your dependencies and your network speed, this could take anywhere from a few seconds to a few minutes.

### Running npm scripts

As a convenience, `fyn` implements `npm run` by utilizing the same modules from [npm]. You can run your [npm scripts] in `package.json`. An alias command `fun` is available also:

- `test` - `fyn test` or `fun test`
- any script - `fyn run <script-name>` or `fun <script-name>`
- list scripts - `fyn run -l` or `fun -l`

### The `stat` command

If you have a lockfile, then `fyn` takes sub seconds to regenerate the entire dependency tree even on very large applications. This makes it very fast to probe what's installed.

It has a `stat` command that's very fast and can let you know all copies of a package installed and all others that depend on it.

For example:

```sh
$ fyn stat chalk
> loaded lockfile ~/fyn
> done resolving dependencies 0.113secs
> chalk matched these installed versions chalk@2.4.1, chalk@1.1.3(fv)
> chalk@2.4.1 has these dependents eslint@4.19.1, inquirer@3.3.0, table@4.0.2, visual-exec@0.1.0, visual-logger@0.1.8, webpack-bundle-analyzer@2.13.1, xclap@0.2.24, ~package.json
> chalk@1.1.3 has these dependents babel-code-frame@6.26.0, electrode-server@1.5.1
```

#### Locking Dependencies by Time

Ever want to install your dependencies only consider packages published up to a certain date in the past? `fyn`'s got you covered with the `--lock-time` option.

- First rename or remove `fyn-lock.yaml` file.
- Then run install like this:

```sh
rm fyn-lock.yaml
fyn install --lock-time "12/01/2018"
```

Or

```sh
fyn install --lock-time "dec 01, 2018"
```

And `fyn` will only consider packages published up to Dec 01, 2018 when installing.

### Refreshing Optional Dependencies

If you have any optional dependencies, then they will not be re-evaluated if you have a lock file.

You can re-evaluate optional dependencies with `--refresh-optionals` option:

```sh
fyn install --refresh-optionals
```

#### Using with Lerna

[lerna] actually implements its own internal `npm link` like feature to support a monorepo with packages that depend on each other.

`fyn` works particularly well with a [lerna] monorepo, but since it offers an enhanced `npm link`, it replaces [lerna]'s bootstrap feature.

To bootstrap a [lerna] repo with `fyn`'s enhanced `npm link`, please use the module [fynpo].

`fyn` also has a [central storage](#central-storage) option that would saves you a lot of disk space when working with [lerna] repos.

You can use [fynpo]'s `local` command to update and commit your monorepo's packages' `package.json`, and you can run `fyn` to install and update their dependencies without having to do it through bootstrap.

For example:

```sh
fynpo local
cd packages/my-awesome-package
fyn
```

## Configuring fyn

fyn options can be listed in help:

```sh
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

### Command Line Option to RC Mapping

> Any command line option can be converted to an option in the RC file by changing the name to camelCase form.

If there's no RC file or command line override, then these defaults are used:

- `registry` - `https://registry.npmjs.org`
- `progress` - `normal`
- `logLevel` - `info`

### Other RC Options

#### Scope registry

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

### Central Storage

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

In general if disk space is not an issue for you, then it's better to avoid this and the issues that will likely creep up on you when you least expect it.

If you do have a use of this feature despite the drawbacks, then you can enable it with the `--central-store` CLI option.

The recommendation is to add the following to `.fynrc` because then you don't have to remember to specify the option in the CLI every time.

```ini
centralStore=true
```

You can also set the env variable `FYN_CENTRAL_DIR` to `1` to enable it.
If you set it to point to a directory then it will be used as the central store directory.

And to work around the issues, `fyn` does the following:

- issue 2: `fyn` has a `--copy` option that allows you to force any package to install with copying instead of hardlinking.
- issue 3: `fyn` will not hard link packages from central store if they have `preinstall`, `install`, or `postinstall` npm scripts.

## Other Info

### Compatibility

- `fyn`'s top level `node_modules` is 100% compatible with Node.js and 3rd party tools and modules. No special updates or changes needed.

- `fyn` uses npm's [pacote] to do data retrieval. That means its package data handling is the same as npm and it can use npm's cache directly.

- The way `fyn` uses symlinks to resolve nested dependencies is also fully compatible with Node.js. The only caveat is Node.js module loader always resolve a package's path to its real path.

  For example, if `A` depends on `B@1.0.0` that's not at the top level, then `node_modules/A/node_modules/B` is a symlink to `node_modules/B/__fv_/1.0.0/B`.

  Without preserve symlinks, `B`'s path would be resolved to the real path `node_modules/B/__fv_/1.0.0/B`, instead of the symlink path `node_modules/A/node_modules/B`.

  If you want to keep the symlink path, then set the environment variable [NODE_PRESERVE_SYMLINKS] to `1`. It doesn't affect normal operations either way unless you have code that explicitly depend on the path, which should be avoided. The subtle difference is that with preserve symlink, each symlink path of the same module will be loaded as its own instance by Node's module system.

- `fyn` will take [npm]'s `npm-shrinkwrap.json` or `package-lock.json` if its own `fyn-lock.yaml` file doesn't exist, but will save `fyn-lock.yaml` after.

### Package Resolution and Layout

As a package manager, the top level `node_modules` installed by `fyn` is a flat list of all the modules your application needs. It's easier to view and smaller in size. Extra versions of a module will be installed under a directory `__fv_` and linked with symlink or dir junction on Windows.

`fyn` has an asynchronous and concurrent dependency resolution engine that is 100% compatible with node's nesting design, and properly handles `optionalDependencies`.

### Thank you `npm`

Node Package Manager is a very large and complex piece of software. Developing `fyn` was 10 times easier because of the generous open source software from the community, especially the individual packages that are part of `npm`.

Other than benefiting from the massive package ecosystem and all the documents from `npm`, these are the concrete packages from `npm` that `fyn` is using directly.

- [node-tar] - for untaring `tgz` files.
- [semver] - for handling Semver versions.
- [pacote] - for retrieving `npm` package data.
- [ini] - for handling `ini` config files.
- [npm-packlist] - for filtering files according to npm ignore rules.
- [npm-lifecycle] - for npm_config env and offering `run` as a convenience.
- [npmlog] - for offering the `run` command as a convenience.
- And all the other packages they depend on.

## License

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
[travis-image]: https://travis-ci.org/electrode-io/fyn.svg?branch=master
[travis-url]: https://travis-ci.org/electrode-io/fyn
[npm-image]: https://badge.fury.io/js/fyn.svg
[npm-url]: https://npmjs.org/package/fyn
[coveralls-image]: https://coveralls.io/repos/github/electrode-io/fyn/badge.svg?branch=master
[coveralls-url]: https://coveralls.io/github/electrode-io/fyn?branch=master
[daviddm-image]: https://david-dm.org/electrode-io/fyn/status.svg
[daviddm-url]: https://david-dm.org/electrode-io/fyn
[daviddm-dev-image]: https://david-dm.org/electrode-io/fyn/dev-status.svg
[daviddm-dev-url]: https://david-dm.org/electrode-io/fyn?type=dev
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
[npm link]: https://docs.npmjs.com/cli/link.html
[npm-lifecycle]: https://www.npmjs.com/package/npm-lifecycle
[npmlog]: https://www.npmjs.com/package/npmlog
