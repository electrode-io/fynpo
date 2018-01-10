# fyn: Flatten Your Node_modules

`fyn` is a node package manager for the [flat node_modules design here].

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

`fyn` is a package manager that only installs a `node_modules` structured to work with the [flat node_modules design here].

It requires the `flat-module` support loaded when node starts up. To achieve that, it depends on setting the `--require` option in [NODE_OPTIONS] env NodeJS 8 supports.

This also works for NodeJS 6 but you have to explicitly specify the `--require` option when invoking node and child process wouldn't inherit that.

> Not working for Windows yet. Un\*x only.

# Compatibility

The `flat-module` extension is 100% compatible and co-exist with node's nesting module system.

The top level `node_modules` installed by `fyn` is a flat list of all the modules your application needs and is fully compatible with node's module system. It just means that without the `flat-module` extenstion, for any module with multiple versions, you will only get the top level version, so something breaking is very likely.

`fyn` has a fully asynchrounous and concurrent dependencies resolving engine that works 100% according to node's nesting design, and is the only one that can properly handle `optionalDependencies`.

# Install

Please install `fyn` to your NodeJS setup globally.

```bash
npm install -g fyn
```

# Usage

Setup the [NODE_OPTIONS] env for bash:

```bash
eval `fyn bash`
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

### Node 6 and lower

Only Node 8 and up supports [NODE_OPTIONS].

For Node 4 and 6, you have to specify the [`-r` option] when you invoke node, like this:

```
node -r <path-to-flat-module>
```

However, `fyn` doesn't really work well even with this, because child process spawn from Node will not inherit that option.

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

fyn also loads config from `~/.fynrc`, which is just a `YAML` file, below is an example:

```yaml
registry: https://registry.npmjs.org
localOnly: false
forceCache: false
lockOnly: false
progress: none
logLevel: verbose
production: false
```

> Any command line option can be converted to an option in the RC file by changing the name to camelCase form.

If there's no RC file and command line override, then these default are used:

* `registry` - `https://registry.npmjs.org`
* `progress` - `normal`
* `logLevel` - `info`

[flat node_modules design here]: https://github.com/jchip/node-flat-module
[node_options]: https://nodejs.org/dist/latest-v8.x/docs/api/cli.html#cli_node_options_options
[`-r` option]: https://nodejs.org/docs/latest-v6.x/api/cli.html#cli_r_require_module
