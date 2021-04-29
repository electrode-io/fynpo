---
id: updated
title: fynpo updated
---

:::note 
Install [fynpo-cli](/docs/packages#fynpo-cli) for global access of fynpo command
:::

## Usage

```
fynpo updated
```

Return the list the packages that have been changed since last release. The returned list will be the subjects of the next `fynpo changelog` execution.

Similar to [lerna changed](https://github.com/lerna/lerna/tree/main/commands/changed#readme) command.

## Options

**`--force-publish`**

specify the list of packages to be force published or use `*` for all packages. 

```
fynpo updated --force-publish pkg1 pkg3
fynpo updated --force-publish *
```

May also be configured in `fynpo.json` or `fynpo.config.js`.

```javascript
{
  forcePublish: ["*"]
}
```

```javascript
{
  forcePublish: ["pkg1", "pkg2"] 
}
```

**`--ignore-changes`**

Ignore changes in files matched by glob(s) when detecting changed packages.

```
fynpo updated --ignore-changes '**/*.md' '**/__tests__/**'
```

May also be configured in `fynpo.json` or `fynpo.config.js`.

```javascript
{
  "ignoreChanges": ["**/__tests__/**", "**/*.md"]
}
```
