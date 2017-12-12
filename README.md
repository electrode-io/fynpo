# fyn: Flatten Your NodeModules

fyn is a node package manager for the [flat node_modules design here].

# Features

* Dependencies information retained and checked at runtime.
* Your application will not silently load bad dependencies.
* Always deterministic node_modules installation.
* Super fast performance.
* Clean and flexible depencies locking.
* Support locking module meta versions.
* Generate super detailed stats of your dependencies.
* Multiple but related modules development that just works.
* Incremental install - add and remove any dep and get a deterministic install
* Proper handling of `optionalDependencies`
* Local package linking that works seamlessly

# Meta Versions Lock

fyn automatically saves the meta versions data after an install. Next time you install again it will use the same meta versions and you will get the exact same versions of modules.

To get newer versions of your dependencies, you can:

* Remove all the meta data and install all packages that have updates.
* Selectively remove the meta for any packages and have only those updated.
* Refresh meta during install

# DESIGN

## git URL semver

* <https://docs.npmjs.com/files/package.json#git-urls-as-dependencies>
* <https://docs.npmjs.com/files/package.json#github-urls>

If a dep specifies semver as a git URL, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## tarball URL semver

* <https://docs.npmjs.com/files/package.json#urls-as-dependencies>

If a dep specifies a semver as a URL to a tarball, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## Dependencies Promotion

* Auto promote latest version.
* Specify which version of a package to promote.
* Remove existing promoted version
* Remove any old copy of newly promoted version.

## Lock Dependencies

* Lock each package by `name@semver` to a fixed version.
* Local lock dependencies of a package.
* All non-locked dep resolving is subjected to change.
* Interactively select package and its version to lock.

[flat node_modules design here]: https://github.com/jchip/node-flat-module
