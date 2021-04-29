---
id: intro
title: Introduction
---

In JavaScript development, using a mono-repo to manage multiple components/packages is very beneficial and saves a lot of time. **fynpo** is a mono-repo management tool that uses [fyn](https://www.npmjs.com/package/fyn) for installing dependencies. fynpo is designed from the ground up to enable a mono-repo that 100% retains the standard npm workflow.  It offers all the benefits of mono-repo workspace plus more and none of the usual downsides.

Fynpo monorepo solution has two parts: 

**[fyn](https://www.npmjs.com/package/fyn)**: a fully npm compatible Node.js Package Manager (NPM) with support for integrated local handling.

**[fypo](https://github.com/electrode-io/fynpo)**: a lerna based mono-repo management tool that uses fyn for installing dependencies.

## How It Works

**fynpo** uses [fyn](https://www.npmjs.com/package/fyn) for managing dependencies. fyn is a node package manager that makes your disk a direct registry. It enables you to develop, publish, and test all your packages using local copies directly.

#### fynlocal mode

**fyn** subjects local packages to the same dependency resolution logic as those from the npm registry. It effectively makes your disk a npm registry by treating packages on your local disk like they've been published. You can install and use them directly, and quickly test changes iteratively. It fits perfectly with the mono-repo workspace concept.

To enable, use the path to your local modules as semver in your package.json, or you can use the fyn add command.

For example:

```
fyn add ../my-awesome-module
```

That will install `my-awesome-module` into your `node_modules`. You can continue to develop and test my-awesome-module in its own directory and have the changes within existing files reflected in your app directly. Unlike [npm link](https://docs.npmjs.com/cli/v7/commands/npm-link), your app resolves dependencies for my-awesome-module instead of relying on having them installed under my-awesome-module/node_modules.

#### Smaller node_modules

fyn's node_modules structure is the smallest possible in size because there are no multiple copies of the exact same package installed.

As a package manager, fyn employs a different approach that installs only one copy of every required versions of a package in a flat node_modules structure. It installs a copy of each version under the directory "node_modules/.f/_/package_name/version". And it uses symlink to hoist a single version to node_modules for visibility. A package may have their own node_modules to resolve version differences.

This approach has the benefit of guaranteeing a single copy of a package installed and therefore slightly smaller size node_modules.

## Fynpo repo

File structure of a fynpo monorepo will look like:

```
fynpo-repo/
  package.json
  fynpo.config.js
  packages/
    package-1/
      package.json
    package-2/
      package.json
```
