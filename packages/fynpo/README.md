# fynpo

**A node.js JavaScript monorepo manager, that solves some common issues with monorepos.**

- [docs](https://www.electrode.io/fynpo/docs/intro)

### Features:

- **Integrated Local Package Handling**: No symlink magic, no dependencies hoisting, and no mixing packages.

  > Fynpo has a local package resolution logic that's fully integrated with the normal NPM package.json install process, free of the issues other solutions have because their local package handling is either just an add-on to the actual install process or depends on some hack like hoisting packages. **This solves all of yarn's issues listed [here](https://classic.yarnpkg.com/en/docs/workspaces/#toc-limitations-caveats)**.

- **Locally Published Workflow**: packages install in their published form locally in the monorepo.

  > No more surprises after packages are published. If things work locally, then they will work published.

- **100% npm Compatible workflow**: all the things you know about development using npm, like `npm run`, continue to work.

  > This makes switching to another monorepo solution simple should you want to. fyn can even use npm's package-lock.json file.

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

## License

Copyright (c) 2015-present, WalmartLabs

Licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).
