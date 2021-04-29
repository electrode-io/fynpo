---
id: packages
title: The Packages
---

Fynpo monorepo solution includes 4 npm packages:

### [create-fynpo](https://github.com/electrode-io/fynpo/tree/master/packages/create-fynpo)
Supplement tool to create a new fynpo monorepo.

```
npx create-fynpo fynpo-repo
cd fynpo-repo
fyn  # Install dependencies
```

Adds `fynpo` as a dev dependency in the monorepo and also add necessary configurations.

### [fynpo](https://github.com/electrode-io/fynpo/tree/master/packages/fynpo)
The main mono-repo management tool that the user's mono-repo installs. It supports the below listed commands.

- `fynpo init` - Initialize a new fynpo monorepo. Supports `commitlint` option to add commitlint config to an existing repo.

- `fynpo bootstrap` - Bootstrap all the packages in the current fynpo repo. Running this command will install deppendencies,      build the packages (if enabled in configuration), and also link the local dependencies.

- `fynpo commitlint` - Check if commit message adhere to a commit convention.

- `fynpo run script` - Run the given npm script in each package that contains the script.

- `fynpo updated` - List the packages that have been changed since last release

- ` fynpo changelog` - Detect the changed packages since last release, decide the version bump based on commit messages and update changelog file.

- `fynpo prepare` - Read changelog, do version bump and add a publish commit.

- `fynpo publish` - Publish the packages thats been updated.

### [fynpo-cli](https://github.com/electrode-io/fynpo/tree/master/packages/fynpo-cli)
A lightweight module that's only for installing to npm global.
This allows user to invoke fynpo commands from within a package and not require npx.

```
npm i -g fynpo-cli
```

### [fyn](https://github.com/electrode-io/fyn)
The node.js package manager that handles installing dependencies. It will have some fynpo awareness and load any relevant fynpo config when a mono-repo is detected.t's best if user has this install into npm global.

```
npm i -g fyn
cd <your-project>
fyn
```