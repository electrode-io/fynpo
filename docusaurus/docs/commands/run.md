---
id: run
title: fynpo run
---

:::note 
Install [fynpo-cli](/docs/packages#fynpo-cli) for global access of fynpo command
:::

## Usage

```
fynpo run <my-script> -- [..args]
fynpo run build
fynpo run test
```

Run given npm script in all the packages that contain that script. A double-dash (--) is necessary to pass dashed arguments to the script execution.

Similar to [lerna run](https://github.com/lerna/lerna/tree/main/commands/run#readme) command.

## Options

**`--ignore`**

Exclude given list of packages

```
fynpo run build --ignore pkg1 pkg2
```

**`--only`**

Run the script in only listed packages

```
fynpo run build --only pkg1 pkg2
```

**`--scope`**

Run the script in only packages with the given scope names

```
fynpo run build --scope @my-scope1 @my-scope2
```

**`--deps`**

Level of dependencies to include regardless of `--scope`, `--ignore`, or `--only`. Default is `10`. Set this as `0` to exclude dependencies.

```
fynpo run build --scope @my-scope1 --deps 0
```

**`--stream`**

Stream output from child processes immediately, prefixed with the originating package name. This allows output from different packages to be interleaved.

```
fynpo run build --stream
```

**`--parallel`**

Similar to `--stream`, but completely disregards concurrency and topological sorting, running a given command or script immediately in all matching packages with prefixed streaming output.

```
fynpo run build --parallel
```

**`--no-prefix`**

Disable package name prefixing when output is streaming (--stream or --parallel). This option can be useful when piping results to other processes, such as editor plugins.

```
fynpo run build --stream --no-prefix
```

**`--no-bail`**

By default, `fynpo run` will exit with an error if any script run returns a non-zero exit code. Pass `--no-bail` to disable this behavior, running the script in all packages that contain it regardless of exit code.

```
fynpo run test --no-bail
```

**`--concurrency`**

Number of packages to execute the script concurrently. Default is `3`.

```
fynpo run build --concurrency 5
```

**`--no-sort`**

By default, scripts are executed on packages in topologically sorted order as to respect the dependency relationships of the packages in question. Passs `no-sort` to disable topological sorting and to execut tasks in an arbitrary order with maximum concurrency.

```
fynpo run build --no-sort
```
