---
id: changelog
title: fynpo changelog
---

:::note 
Install [fynpo-cli](/docs/packages#fynpo-cli) for global access of fynpo command
:::

## Usage

```
fynpo changelog
```

Detect the changed packages since last release, determine version bumps based on commit messages and update `CHANGELOG.md` file.

## Options

**`--force-publish`**

specify the list of packages to be force published or use `*` for all packages. 

```
fynpo changelog --force-publish pkg1 pkg3
fynpo changelog --force-publish *
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
fynpo changelog --ignore-changes '**/*.md' '**/__tests__/**'
```

May also be configured in `fynpo.json` or `fynpo.config.js`.

```javascript
{
  "ignoreChanges": ["**/__tests__/**", "**/*.md"]
}
```

**`--no-commit`**

By default, `fynpo changelog` will commit the changes to `CHANGELOG.md` with the commit message `Update Changelog`. Pass `--no-commit` to disable this behavior.

```
fynpo changelog --no-commit
```

**`--publish`**

If `publish` option is passed, `changelog` command will also modify package metadata to reflect new release (similar to `fynpo preprae` command) and commit the changes to packages and changelog file with the message `[Publish]...`.

```
fynpo changelog --publish
```

**`--tag`**

This option is valid only if `--publish` is passed. If `--tag` option is passed, `changelog` will create individual tags for each changed packages.

```
fynpo changelog --publish --tag
```






