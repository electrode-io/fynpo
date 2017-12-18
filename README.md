# fyn: Flatten Your NodeModules

fyn is a node package manager for the [flat node_modules design here].

# Features

* Dependencies information retained and checked at runtime.
* Your application will not silently load bad dependencies.
* Always deterministic node_modules installation.
* Super fast performance.
* Clean and flexible depencies locking.
* Generate super detailed stats of your dependencies.
* Incremental install - add and remove any dep and get a deterministic install.
* Proper handling of `optionalDependencies`.
* Local package linking for development that works seamlessly.

# Requirements

`fyn` is a package manager that only installs a `node_modules` structured to work with the [flat node_modules design here]. It requires the `flat-module` support loaded when node starts up. To achieve that, it depends on setting the `--require` option in [NODE_OPTIONS] env NodeJS 8 supports.

> Not working for Windows yet. Un\*x only.

# Install

Please install `fyn` to your NodeJS setup globally.

```bash
npm install -g fyn
```

# Usage

Setup the [NODE_OPTIONS] env for bash:

```bash
eval $(fyn bash)
```

* Or you can set it up manually:

```bash
export NODE_OPTIONS="-r <path-to-flat-module>"
```

You can find `<path-to-flat-module>` with this command:

```bash
fyn fm
```

And you are ready to use `fyn`.

> If you use another shell other than bash, please check its docs for instructions on how to set environment variables.

# Installing with fyn

Change into the directory for your project with the `package.json` file, and run:

```bash
fyn install
```

And watch the installation happen. Depending on the size of your dependencies and your network speed, this could take anywhere from a few seconds to a few minutes.

# Configuring fyn

You can see the options fyn supports with:

```bash
fyn --help
```

fyn also loads config from `~/.fynrc`, which is just a `YAML` file with the following supported fields:

```yaml
registry: https://registry.npmjs.org
localOnly: true
forceCache: true
lockOnly: true
```

# TODOs

## Cache

* Automatic set refresh time for meta and reuse local copy for a while
* Self integrity check and healing cache
* Allow manually update meta cache

## git URL semver

* <https://docs.npmjs.com/files/package.json#git-urls-as-dependencies>
* <https://docs.npmjs.com/files/package.json#github-urls>

If a dep specifies semver as a git URL, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## tarball URL semver

* <https://docs.npmjs.com/files/package.json#urls-as-dependencies>

If a dep specifies a semver as a URL to a tarball, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## Lock Dependencies

* Lock failed optional dependencies
* Local lock dependencies of a package.
* All non-locked dep resolving is subjected to change.
* Interactively select package and its version to lock.

[flat node_modules design here]: https://github.com/jchip/node-flat-module
[node_options]: https://nodejs.org/dist/latest-v8.x/docs/api/cli.html#cli_node_options_options
