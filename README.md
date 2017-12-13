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
