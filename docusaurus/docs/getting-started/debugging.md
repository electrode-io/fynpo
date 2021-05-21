---
id: debugging
title: Debugging
---

## The Problem

When you install a local package **Pkg_A** in another local package **Pkg_B**, `fyn` creates hard linked copies of **Pkg_A**'s files in **Pkg_B**'s `node_modules`.

Like this:

```
├── fynpo.config.js
└── packages
    ├── Pkg_A
    │   ├── index.js          <────────┐
    │   └── package.json               |
    └── Pkg_B                          |
        ├── index.js                   | hard link
        ├── node_modules               |
        │   └── Pkg_A                  |
        │       └── index.js   ────────┘
        └── package.json
```

The file `Pkg_A/index.js` shows up in two locations but they are the same file because they are linked. Modifying one will change the other.

**There is still a problem with this**: when you are debugging **Pkg_B**, if you need to trace through code in `Pkg_A/index.js`, your debugger will only see `Pkg_B/node_modules/Pkg_A/index.js`, not the one under `packages/Pkg_A/index.js`.

_A rather inconvenient situation._

Other monorepo workspace solutions may not have this problem because they use symbolic links to link local packages, but that causes other problems like the ones listed in [yarn](https://classic.yarnpkg.com/en/docs/workspaces/#toc-limitations-caveats).

## `fyn`'s Solution

If your debugger supports source maps, like the one in [Visual Studio Code], then `fyn` offers a way to solve this.

There are two ways that we can get source maps:

1. If your source code is in another dialect like TypeScript, then your packages are installed with the transpiled code. And you must enable source maps when you transpile your code.
2. If you write your source code in idiomatic JavaScript, then `fyn` needs to generate pseudo source maps for them.

- With (1), you don't need to do anything, `fyn` will take care of everything for you.
- With (2), `fyn` will also automatically take care of everything for you, but there is something it leaves in your code that you need to be aware of. See [fynSourceMap](#fynsourcemap) below.

To make use of the source maps `fyn` setup for you, you need to setup your debugger to tell it to load source maps for code in `node_modules`, because most debuggers by default ignore files under `node_modules` for source maps.

For [Visual Studio Code], this is a sample of what you need to setup in `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach app demo",
      "port": 9229,
      "request": "attach",
      "skipFiles": ["<node_internals>/**"],
      "type": "pwa-node",
      "cwd": "${workspaceFolder}/apps/app-demo",
      // outFiles tells vscode debugger the files it should look for source map info
      "outFiles": [
        // using ${cwd} here doesn't seem to work
        // first exclude everything under node_modules
        "!${workspaceFolder}/apps/app-demo/node_modules/**",
        // when running app from transpiled code
        "${workspaceFolder}/apps/app-demo/lib/**/*.js",
        // when running app from source transpile on-the-fly with @babel/register
        "${workspaceFolder}/apps/app-demo/src/**/*.(ts|tsx|js|jsx)",
        // process any @myscope packages under node_modules for source mapping
        // .f/_ is where fyn put the real copies of packages
        "${workspaceFolder}/apps/app-demo/node_modules/.f/_/@myscope/**/*.js"
      ]
    }
  ]
}
```

This example assumes you put your local packages under the npm scope `@myscope` and the `outFiles` entry `"${workspaceFolder}/apps/app-demo/node_modules/.f/_/@myscope/**/*.js"` tells [Visual Studio Code] debugger to process source maps under that directory and open the one in your original `packages` directory under your monorepo.

## `fynSourceMap`

If your code is idiomatic JavaScript without a transpile step, then `fyn` needs to generate pseudo source maps for your code.

It needs to add to your code the reference to the source maps so [Visual Studio Code] will load them.

It looks like this in a file named `index.js`:

```
//# fynSourceMap=true
//# sourceMappingURL=index.js.fyn.map
```

- It's recommended that you commit your code with these for convenience.
- You can tell `fyn` to skip generating pseudo source maps by setting `fynSourceMap` to `false`.
- If you use `nyc` for unit test coverage, then it will fail trying to load the source maps. To get around that, set `nyc`'s option `sourceMap` to `false`.

## Summary

With a debugger that supports source maps, you can debug and trace through your code in your `fynpo` using the original copy of your files instead of the one linked in `node_modules`.

[visual studio code]: https://code.visualstudio.com/
