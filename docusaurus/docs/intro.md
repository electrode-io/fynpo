---
id: intro
title: Introduction
---

**[fynpo] is a zero setup monorepo manager for node.js**

In JavaScript development, using a monorepo to manage multiple components or packages is makes it very convenient to work on them together. `fynpo` is a monorepo manager tool designed to work with npm packages and their npm scripts. Just put your existing npm packages together and fynpo will manage them as a monorepo without any fuss.

See [this express monorepo PoC](https://github.com/jchip/express-monorepo) that put [express](https://expressjs.com/) and all its dependencies together in a monorepo, with their source cloned from their repos directly.

### Features:

- **zero setup monorepo manager for node.js** - Put existing npm packages together in a monorepo without changes.

  > Fynpo is designed to work with npm packages and their npm scripts. Just put your existing npm packages together and fynpo will orchestrate and manage them in a monorepo without any fuss. All the things you know about development using npm, like `npm run`, continue to work. This makes switching to another monorepo solution simple should you want to. fyn can even use npm's package-lock.json file.

- **Integrated Local Package Handling**: No symlink magic, no dependencies hoisting, and no mixing packages.

  > Fynpo has a local package resolution logic that's fully integrated with the normal NPM package.json install process, free of the issues other solutions have because their local package handling is either just an add-on to the actual install process or depends on some hack like hoisting packages. **This solves all of yarn's issues listed [here](https://classic.yarnpkg.com/en/docs/workspaces/#toc-limitations-caveats)**.

- **Locally Published Workflow**: packages installed in their published form locally in the monorepo.

  > No more surprises after packages are published. If things work locally, then they will work published.

- **Freedom and Flexibility**: your development is **not** restricted to a monorepo utopia bubble.

  > Any app or packages outside can use all packages within the monorepo directly, and vice-versa. - they are not confined to the monorepo.

- **Self contained apps**: Application in the monorepo functions on its own and not confined to the monorepo.

  > After installing, each app or package in fynpo has its own directory that doesn't rely on other parts of the monorepo and you can simply zip it up, deploy it, or copy it to a container image and it would just work. If you want to just put your whole monorepo into a container, fynpo guarantees the smallest possible size.

- **Efficient Storage**: fyn uses a central storage for all of a monorepo's dependencies.

  > Only a single copy of a package is ever taking up disk space for the monorepo.

- **Hybrid Publish Mode**: lock versions of the packages you want.

  > When publishing, allows you to select certain packages to lock versions or be independent.

- **Informative node_modules paths**: For any file from `node_modules`, the path will show its owner package's version.

  > You no longer have to guess or find the version of a package when looking at stack traces.

- **Package Guaranteed Single Copy**: Any package version will have only one copy in `node_modules`
  > A directory layout of packages in `node_modules` that ensures there's only one copy of each package.

## How It Works

**fynpo** uses [fyn](https://www.npmjs.com/package/fyn) for managing dependencies. fyn is a node package manager that makes your disk a direct registry. It enables you to develop, publish, and test all your packages using local copies directly.

### fynlocal mode

**fyn** subjects local packages to the same dependency resolution logic as those from the npm registry. It effectively makes your disk a npm registry by treating packages on your local disk like they've been published. You can install and use them directly, and quickly test changes iteratively. It fits perfectly with the monorepo workspace concept.

To enable, use the path to your local modules as semver in your package.json, or you can use the fyn add command.

For example, from any package, to install another package in your local disk, just do:

```
fyn add ../my-awesome-module
```

That will install `my-awesome-module` into your `node_modules`. You can continue to develop and test my-awesome-module in its own directory and have the changes within existing files reflected in your app directly. Unlike [npm link](https://docs.npmjs.com/cli/v7/commands/npm-link), your app resolves dependencies for my-awesome-module instead of relying on having them installed under my-awesome-module/node_modules.

[fynpo]: https://github.com/electrode-io/fynpo
