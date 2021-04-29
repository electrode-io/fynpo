# fynpo

In JavaScript development, using a mono-repo to manage multiple components/packages is very beneficial and saves a lot of time. `fynpo` is a mono-repo management tool that uses [fyn](https://www.npmjs.com/package/fyn) for installing dependencies. `fynpo` is designed from the ground up to enable a mono-repo that 100% retains the standard npm workflow.  It offers all the benefits of mono-repo workspace plus more and none of the usual downsides.

This solution has two parts: 

`fyn`: a fully npm compatible Node.js Package Manager (NPM) with support for integrated local handling.

`fypo`: a lerna based mono-repo management tool that uses fyn for installing dependencies.

### Advantages:
- `Efficient Storage`: fyn uses a central storage for all of a mono-repo's dependencies, therefore only a single copy of a package is ever taking up disk space for the repo.

- `Integrated Local Package Handling`: a local package resolution logic that's fully integrated with the normal NPM package.json install process, free of the issues other solutions have because their local package handling is either just an add-on to the actual install process or depends on some hack like hoisting packages.**This solves all of yarn's issues listed [here](https://classic.yarnpkg.com/en/docs/workspaces/#toc-limitations-caveats)**.

- `Hybrid Publish Mode`: when publishing, allows you to select certain packages to lock versions or be independent.

- `100% npm Compatible workflow`: all the things you know about development using npm continue to work, and makes switching to another mono-repo solution simple should you want to. fyn can even use npm's package-lock.json file.

- `Freedom and Flexibility`: your development is **not** restricted to a mono-repo utopia bubble.  Any app or packages outside can use all packages within the mono-repo directly, and vice-versa. 

- `Informative node_modules paths`: For any file from node_modules, the path will show its owner package's version, and you no longer have to guess or find the version of a package when looking at stack traces.

- `Package Guaranteed Single Copy`: unlike npm/yarn that could install multiple copies of the same version of a package, fyn guarantees that each version will have exactly one copy in your node_modules.

- `Container Friendly`: 	Each app or package in fynpo has its own fully self contained directory that can be built and simply copied to a container image and would just work. If you want to just put your whole mono-repo into a container, fynpo guarantees the smallest possible size that's always smaller than yarn or npm workspace.

### npm packages

fynpo monorepo solution includes 3 packages:

**`fynpo`**: It contains the main mono-repo management tool that the user's mono-repo installs.

**`create-fynpo`**: Users can use this package to  initialize a new fynpo mono-repo. 

**`fynpo-cli`**: A lightweight module to allows user to invoke fynpo command anywhere.

## Getting started

Run the below commands to create a new fynpo monorepo:

```
npx create-fynpo fynpo-repo
cd fynpo-repo
fyn  # Install dependencies
```

Running this command will:
 - initialize git repo if not already
 - create a package.json file if it's not exist
 - add fynpo as a devDependency in package.json if it doesn't already exist
 - create a fynpo config file (fynpo.config.js/fynpo.json)
 - create an empty packages folder

Please visit [here](https://github.com/electrode-io/fynpo/blob/master/packages/create-fynpo/README.md) for more detailed information about `create-fynpo`.

## Configuration

```javascript
{
  changeLogMarkers: ["## Packages", "## Commits"],
  command: { 
    bootstrap: { npmRunScripts: ["build"] },
    publish: { tags: {}, versionTagging: {} }
  },
  forcePublish: [],
  ignoreChanges: [],
  versionLocks: [],
  commitlint: {
  },
}
```
**`changeLogMarkers`** - The markers used to list the changed packages and corresponding commit messages in `CHANGELOG.md`. This will be used by `fynpo prepare` command to read the changed packages and their new verisons from `CHANGELOG.md` and to update their `package.json`.

**`command.bootstrap.npmRunScripts`** - npm scripts to run for each package while bootstrapping them.

**`command.publish.tags`** - To publish to npm with the given npm dist-tag. Users can specify different tags for different packages and also enable/disable tags for individual or multiple packages.

**`command.publish.versionTagging`** - To add `ver[pkgVerison]` as `dist-tag`.

**`forcePublish`** - List of packages to be force published. Use `*` for all packages.

**`ignoreChanges`** - Patterns to ignore changes in files matched when detecting changed packages.

**`versionLocks`** - Group of packages to be version locked together. Use ['*'] to lock the verisons of all the packages together.

**`commitlint`** - commit lint configuration.

## Commands

**`fynpo init`** - Initialize a new fynpo monorepo. Supports `commitlint` option to add commitlint config to an existing repo.

**`fynpo bootstrap`** - Bootstrap all the packages in the current fynpo repo. Running this command will install deppendencies, build the packages (if enabled in configuration), and also link the local dependencies.

**`fynpo commitlint`** - Check if commit message adhere to a commit convention.

**`fynpo run script`** - Run the given npm script in each package that contains the script.

**`fynpo updated`** - List the packages that have been changed since last release

**` fynpo changelog`** - Detect the changed packages since last release, decide the version bump based on commit messages and update changelog file.

**`fynpo prepare`** - Read changelog, do version bump and add a publish commit.

**`fynpo publish`** - Publish the packages thats been updated.


Refer [here](https://github.com/electrode-io/fynpo/blob/master/packages/fynpo/README.md) for detailed information about each of these commands, supported options and configuration.

## Global fynpo command

If you'd like to get the command `fynpo` globally, you can install another small npm module `fynpo-cli` globally. This allows user to invoke fynpo command anywhere (within a package) and not require npx.

```
npm i -g fynpo-cli
```

 




