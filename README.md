# fyn: Flatten Your NodeModules

fyn is a node package manager for the [flat node_modules design here].

# Features

-   Dependencies information retained and checked at runtime.
-   Your application will not silently load bad dependencies.
-   Always deterministic node_modules installation.
-   Super fast performance.
-   **_The best version lock bar none._**
-   Support locking module meta versions.
-   Generate super detailed stats of your dependencies.
-   Multiple but related modules development that just works.

# Meta Versions Lock

fyn automatically saves the meta versions data after an install.  Next time you install again it will use the same meta versions and you will get the exact same versions of modules.

To get newer versions of your dependencies, you can:

-   Remove all the meta data and install all packages that have updates.
-   Selectively remove the meta for any packages and have only those updated.
-   Refresh meta during install

# DESIGN

## Incremental Install

-   Be able to take an existing installation, refresh, and remove any package that's not needed anymore.

## Optional Dependencies

-   Before resolving dependencies of an optional package, fetch it and execute the `preinstall` script.
-   If `preinstall` script passed, then add all its dependencies to the resolving pipeline.
-   If it failed, then remove it from installation.

## Peer Dependencies

-   Each peer dep is added to a queue and checked at the end.
-   Need to honor lock information when resolving.

## Local FS semver

-   <https://docs.npmjs.com/files/package.json#local-paths>

If a dep specifies semver as a local FS path, then need load its `package.json` into meta and resolve with FS ops.

## git URL semver

-   <https://docs.npmjs.com/files/package.json#git-urls-as-dependencies>
-   <https://docs.npmjs.com/files/package.json#github-urls>

If a dep specifies semver as a git URL, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## tarball URL semver

-   <https://docs.npmjs.com/files/package.json#urls-as-dependencies>

If a dep specifies a semver as a URL to a tarball, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## Dependencies Promotion

-   Auto promote latest version.
-   Specify which version of a package to promote.
-   Remove existing promoted version
-   Remove any old copy of newly promoted version.

## Lock Dependencies

-   Lock each package by `name@semver` to a fixed version.
-   Local lock dependencies of a package.
-   All non-locked dep resolving is subjected to change.
-   Interactively select package and its version to lock.

[flat node_modules design here]: https://github.com/jchip/node-flat-module
