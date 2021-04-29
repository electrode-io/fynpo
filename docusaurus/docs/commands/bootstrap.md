---
id: bootstrap
title: fynpo bootstrap
---

:::note 
Install [fynpo-cli](/docs/packages#fynpo-cli) for global access of fynpo command
:::

## Usage

```
fynpo bootstrap
```

Bootstrap the packages in the current fynpo repo, installs all of their dependencies and links any local dependencies. Users can configure npm scripts to run for each package while bootstrapping them in `fynpo.config.js` or `fynpo.json`.

```javascript
command: {
    bootstrap: { npmRunScripts: ["build"] },
}
```

## Options

**`--ignore`**

Exclude list of packages from bootstrapping

```
fynpo bootstrap --ignore pkg1 pkg2
```

**`--only`**

Bootstrap only listed packages 

```
fynpo bootstrap --only pkg1 pkg2
```

**`--scope`**

Bootstrap only packages with the given scope names

```
fynpo bootstrap --scope @my-scope1 @my-scope2
```

**`--deps`**

Level of dependencies to include regardless of `--scope`, `--ignore`, or `--only`. Default is `10`. Set this as `0` to exclude dependencies.

```
fynpo bootstrap --scope @my-scope1 --deps 0
```

**`--skip`**

List of packages to skip running fyn install on, but won't ignore.

```
fynpo bootstrap --skip pkg3 pkg5
```

**`--concurrency`**

Number of packages to bootstrap concurrently. Default is `3`.

```
fynpo bootstrap --concurrency 5
```

**`--build`**

Run npm script build if no prepare while bootstrapping.

```
fynpo bootstrap --build
```