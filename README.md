# fyn: Flatten Your Node_modules

`fyn` is a fast node package manager for the [flat node_modules design].

It installs only one copy of every package and uses symlink/junction to setup the module dependencies.

[Flat-module] offers a better local module development workflow than `npm link`.

![fyn demo][fyn-demo-gif]

# Features

* A single copy of installed packages.
* Dependencies retained and checked at runtime. (with [flat-module])
* Will not silently load bad dependencies. (with [flat-module])
* Better local development workflow than `npm link`. (with [flat-module])
* Always deterministic node_modules installation, irrelevant of order.
* Super fast performance. (faster than npm@5 and yarn, and even pnpm in some cases)
* Clean and flexible dependency locking.
* Detailed stats of your dependencies.
* Incremental install - add and remove dependencies in a deterministic fashion.
* Proper handling of `optionalDependencies`.

# Overview

## Package Resolution and Layout

The top level `node_modules` installed by `fyn` is a flat list of all the modules your application needs. Modules with multiple versions will be installed under a directory `__fv_`, and linked through symlinks or [flat-module].

`fyn`'s `node_modules` layout is much easier to view and smaller in size. You can easily see all versions of a packages with the Unix bash command `ls node_modules/*/__fv_`.

`fyn` has an asynchronous and concurrent dependency resolution engine that is 100% compatible with node's nesting design, and properly handles `optionalDependencies`.

## Better `npm link` workflow

With [flat-module], `fyn` offers a better workflow than `npm link`.  Local packages are subjected to the same dependency resolution logic as those from the npm registry.

See [using flat-module](#using-flat-module) if you are interested in trying it out.

# Install

Please install `fyn` to your NodeJS setup globally.

```bash
npm install -g fyn
```

# Node Compatibility

[flat-module] not withstanding, `fyn` top level `node_modules` are 100% compatible with NodeJS, and all tools, including `npm` or `yarn`.

The way `fyn` uses symlinks to link a certain version of a package for another package is also fully compatible with NodeJS. The only caveat is NodeJS module loader always resolve a package's path to its real path.  If you want to keep the symlink path, set the environment variable [NODE_PRESERVE_SYMLINKS] to `1`.

`fyn` can't handle npm's `shrinkwrap.json` and `package-lock.json` files.

# Using fyn

Change into the directory for your project with the `package.json` file, and run:

```bash
fyn install
```

Depending on the size of your dependencies and your network speed, this could take anywhere from a few seconds to a few minutes.

# Configuring fyn

fyn options can are listed in help:

```bash
fyn --help
```

fyn loads config from `CWD/.fynrc`, `CWD/.npmrc`, `~/.fynrc`, and `~/.npmrc` in this specified order, from highest to lowest priority. From `.npmrc`, only fields `registry`, `email`, and `_auth` are read.

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

# Using flat-module

`fyn` is designed to work with [flat-module] to unlock some enhanced features that improve the NodeJS module development workflow.

The original intent of [flat-module] was to improve the workflow of `npm link` when doing local module development. `fyn` installs modules from your local file system like it's a real dependency from the npm registry and requires the [flat-module] support to work properly.

## Requirements

[flat-module] support has to be loaded when node starts up.

For NodeJS 8, set the `--require` option in [NODE_OPTIONS] env.

For NodeJS 6, you have to explicitly specify the `--require` option when invoking node.  Note that child processes wouldn't inherit this value.

## `flat-module` Compatibility

The `flat-module` extension is 100% compatible and co-exist with Node's nesting module system.

If you need to resolve the location of a package, the recommended approach is to use `require.resolve`. If you need to do that for a package within the context of a specific directory, then the recommended way is to use [require-at].

## Preserving Symlinks

Due to NodeJS resolving module paths to their real paths, a symlinked package's path ends up not being part of your `node_modules`.

If you want all paths to appear within your application's directory, set [NODE_PRESERVE_SYMLINKS] to `1`, which [flat-module] is designed to work well with.

## Setup flat-module

### Unix with `bash`

If you are using bash, to setup the [NODE_OPTIONS] env for [flat-module], you have two options:

1. Use `eval` for bash:

```bash
eval `fyn bash`
```

2. Set it up manually:

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

1. Run `fyn win` to generate a batch file `fynwin.cmd` in your current directory.  Invoke `fynwin.cmd` to setup [NODE_OPTIONS]. The file will delete itself.

```batch
fyn win
fynwin
```

2. Run the following command yourself:

```batch
set NODE_OPTIONS=-r <path-to-flat-module>
```

> Suggestions for a better method to setup Windows are welcomed.

### Node 6 and lower

Only Node 8 and up supports [NODE_OPTIONS].

For Node 4 and 6, you have to specify the [`-r` option] when you invoke node, like this:

```
node -r <path-to-flat-module>
```

However, [flat-module] doesn't really work well even with this, because child process spawn from Node will not inherit that option.

[flat-module]: https://github.com/jchip/node-flat-module
[flat node_modules design here]: https://github.com/jchip/node-flat-module
[node_options]: https://nodejs.org/dist/latest-v8.x/docs/api/cli.html#cli_node_options_options
[`-r` option]: https://nodejs.org/docs/latest-v6.x/api/cli.html#cli_r_require_module
[fyn-demo-gif]: ./images/fyn-demo.gif
[ini]: https://www.npmjs.com/package/ini
[node_preserve_symlinks]: https://nodejs.org/docs/latest-v8.x/api/cli.html#cli_node_preserve_symlinks_1
[require-at]: https://www.npmjs.com/package/require-at
