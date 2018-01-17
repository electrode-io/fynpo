# TODOs

## Cache

* Automatic set refresh time for meta and reuse local copy for a while
* Self integrity check and healing cache
  * [x] check shasum as tarball is retrieved
  * [x] save tarball with shasum
* Allow manually update meta cache

## Support URL semver

* git URL semver

  * If a dep specifies semver as a git URL, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.
  * <https://docs.npmjs.com/files/package.json#git-urls-as-dependencies>
  * <https://docs.npmjs.com/files/package.json#github-urls>

* tarball URL semver

  * <https://docs.npmjs.com/files/package.json#urls-as-dependencies>
  * If a dep specifies a semver as a URL to a tarball, then need to retrieve it locally and load its `package.json` into meta and resolve with FS ops.

## Show stats

* Display all dependency paths of a module `[easy]`
* Display versions and semver mappings of a module from lockfile `[easy]`

## Updating Dependencies

* [x] Lock failed optional dependencies
* [x] Local lock dependencies of a package.
* All non-locked dep resolving is subjected to change.
* Interactively select package and its version to lock.
* Interactively update top level dependencies to latest

## Execute lifecycle scripts

* `fyn run` `[easy]`
* `fyn test` `[easy]`

## Install

* `--no-optional` support `[easy]`
* Link `.bin` for `bundledDependencies` `[easy]`
* Final warning about failed and omitted `optionalDependencies` `[easy]`
* Verify version in package.json match expected version
* Multi process pool to extract tarballs
* Save options in lockfile: `--production` and `--no-optional` `[easy]`
* `.bin` linking should look at app's resolutions first before linking all top level modules

## Windows Support

* Support linking `.bin`
* Support checking for semver that is a filepath
* Handle looking up user's home dir for .fynrc and .fyn dir.

## Core

* Promise Q support stages so fetch/extract can be handled by the same Q
* Promise Q support retrying

## Other

* Save errors (especially network errors) and log them in failure output, instead of some random "Cannot read property xyz of undefined", which was caused by the earlier errors.
