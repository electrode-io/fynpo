---
id: design-principles
title: Design Principles
---

- **Efficient Storage**: fyn uses a central storage for all of a mono-repo's dependencies, therefore only a single copy of a package is ever taking up disk space for the repo.

- **Integrated Local Package Handling**: a local package resolution logic that's fully integrated with the normal npm package.json install process, free of the issues other solutions have because their local package handling is either just an add-on to the actual install process or depends on some hack like hoisting packages.**This solves all of yarn's issues listed [here](https://classic.yarnpkg.com/en/docs/workspaces/#toc-limitations-caveats)**.

- **Hybrid Publish Mode**: when publishing, allows you to select certain packages to lock versions or be independent.

- **100% npm Compatible workflow**: all the things you know about development using npm continue to work, and makes switching to another mono-repo solution simple should you want to. fyn can even use npm's package-lock.json file.

- **Freedom and Flexibility**: your development is **not** restricted to a mono-repo utopia bubble.  Any app or packages outside can use all packages within the mono-repo directly, and vice-versa. 

- **Informative node_modules paths**: For any file from node_modules, the path will show its owner package's version, and you no longer have to guess or find the version of a package when looking at stack traces.

- **Package Guaranteed Single Copy**: unlike npm/yarn that could install multiple copies of the same version of a package, fyn guarantees that each version will have exactly one copy in your node_modules.

- **Container Friendly**: 	Each app or package in fynpo has its own fully self contained directory that can be built and simply copied to a container image and would just work. If you want to just put your whole mono-repo into a container, fynpo guarantees the smallest possible size.