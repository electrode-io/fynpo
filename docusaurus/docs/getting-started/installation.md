---
id: installation
title: Installation
---

To create a new fynpo monorepo:

```
npx create-fynpo fynpo-repo
cd fynpo-repo
fyn  # Install dependencies
```

**Note**: We're naming the repo "fynpo-repo". You can name your repo anything you'd like. The npx... command creates a directory with the same name as the repo.

Running this command will:
 - initialize git repo if its not already
 - create a `package.json` file if it's not exist
 - add `fynpo` as a devDependency in package.json
 - creat a `fynpo.json`/ `fynpo.config.js` config file
 - create an empty `packages` directory
 - add `commitlint` config if enabled

Please visit [here](https://github.com/electrode-io/fynpo/blob/master/packages/create-fynpo/README.md) for more detailed information about `create-fynpo`.

#### Options:

**`commitlint`** : Used to initialize the repo with commitlint configuration. This is enabled by default. 

To initialize the repo without commitlint configuration, run the command with `no-commitlint` options. In this case, a simple `fynpo.json` config file will be added instead of `fynpo.config.js`.

```
npx create-fynpo fynpo-repo --no-commitlint
```

The `commitlint` configuration can always be added later by running:

```
npx fynpo init --commitlint
```

## Project Structure

The created mono repo will have the below directory structure:

```
fynpo-repo/
  packages/
  .gitignore
  .npmrc
  fynpo.config.js
  package.json
  README.md
```