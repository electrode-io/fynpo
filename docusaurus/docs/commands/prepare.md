---
id: prepare
title: fynpo prepare
---

:::note 
Install [fynpo-cli](/docs/packages#fynpo-cli) for global access of fynpo command
:::

## Usage

```
fynpo prepare
```

Read changed packages and their versions from `CHANGELOG.md`, modify package metadata to reflect new release, commit and tag the changes.

## Options

**`--no-commit`**

By default, `fynpo prepare` will commit the changes to packages with the commit message `[Publish]...`. Pass `--no-commit` to disable this behavior.

```
fynpo prepare --no-commit
```

**`--tag`**

If `--tag` option is passed, `prepare` will create individual tags for each changed packages.

```
fynpo prepare --tag
```




