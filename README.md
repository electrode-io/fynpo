# fyn: Flatten Your Node_modules

`fyn` is a fast node package manager for the [flat node_modules design here].

It installs only one copy of every package and uses symlink/junction to setup the modules dependencies.

With [flat-module], it offers enhanced support for a much better local module development workflow than `npm link`.

![fyn demo][fyn-demo-gif]

# Features

* Only a single copy of every package installed.
* Dependencies information retained and checked at runtime. (with [flat-module])
* Your application will not silently load bad dependencies. (with [flat-module])
* Better local development workflow than `npm link`. (with [flat-module])
* Always deterministic node_modules installation.
* Super fast performance. (faster than npm@5 and yarn, and even pnpm in some cases)
* Clean and flexible depencies locking.
* Generate super detailed stats of your dependencies.
* Incremental install - add and remove any dep and get a deterministic install.
* Proper handling of `optionalDependencies`.

# Overview

## Packages Resolution and Layout

The top level `node_modules` installed by `fyn` is a flat list of all the modules your application needs. Those with multiple versions will have the extra versions installed under a directory `__fv_` and setup through symlinks or [flat-module].

`fyn` installs a `node_modules` that's much easier to view and smaller in size. You can easily see the extra versions all packages have with the Unix bash command `ls node_modules/*/__fv_`.

`fyn` has an asynchrounous and concurrent dependencies resolving engine that works 100% according to node's nesting design, and is the only one that can properly handle `optionalDependencies`.

## Better `npm link` workflow

With [flat-module], `fyn` unlocks more features that enable a much better workflow than `npm link`. Packages from local file system are subjected to the same dependencies resolution logic as if they came from the npm registry, and symlinked into your `node_modules` that can be used with [flat-module].

See [using flat-module](#using-flat-module) if you are interested in trying it out.

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

And watch the installation happen. Depending on the size of your dependencies and your network speed, this could take anywhere from a few seconds to a few minutes.

# Configuring fyn

You can see the options fyn supports with:

```bash
fyn --help
```

fyn also loads config from `CWD/.fynrc`, `CWD/.npmrc`, `~/.fynrc`, and `~/.npmrc`, in that order, where first ones has higher priority. It only takes these fields from `.npmrc`: `registry`, `email`, and `_auth`.

fyn's RC file can be an [ini] or `YAML` file. To be a `YAML` file, it must starts with a line `---`.

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

If there's no RC file and command line override, then these default are used:

* `registry` - `https://registry.npmjs.org`
* `progress` - `normal`
* `logLevel` - `info`

# Using flat-module

`fyn` is designed to work with [flat-module] in order to unlock some enhanced features that improve your NodeJS module development workflow.

The original intend of [flat-module] was from a desire for a better workflow than `npm link` when doing local module development. `fyn` installs modules from your local file system like it's a real dependency from the npm registry and requires the [flat-module] support to work properly.

## Requirements

To use, the [flat-module] support has to be loaded when node starts up.

To achieve that, it depends on setting the `--require` option in [NODE_OPTIONS] env that NodeJS 8 supports.

This also works for NodeJS 6 but you have to explicitly specify the `--require` option when invoking node and child process wouldn't inherit that.

## Compatibility

The `flat-module` extension is 100% compatible and co-exist with node's nesting module system.

If you need to resolve the location of a package, the recommended approach is to use `require.resolve`. If you need to do that for a package within the context of a specific directory, then the recommended way is to use [require-at].

## Preserving Symlinks

Due to NodeJS resolving module paths to their real paths, a symlinked package's path ends up not being part of your `node_modules`.

If you want all paths to appear within your application's directory, then you can set [NODE_PRESERVE_SYMLINKS] to `1`, which [flat-module] is designed to work well with.

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

1. Run `fyn win` to generate a batch file `fynwin.cmd` at your current directory, which you can invoke with `fynwin` to setup [NODE_OPTIONS]. The file will delete itself.

```batch
fyn win
fynwin
```

2. Run the following command yourself:

```batch
set NODE_OPTIONS=-r <path-to-flat-module>
```

> Any suggestions for doing this better on Windows welcomed.

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
