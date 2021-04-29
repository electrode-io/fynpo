---
id: publish-cmd
title: fynpo publish
---

:::note 
Install [fynpo-cli](/docs/packages#fynpo-cli) for global access of fynpo command
:::

## Usage

```
fynpo publish
```

Publish updated packages since last release and add release tag.

## Options

**`--dist-tag`**

When run with this option, `fynpo publish` will publish to npm with the given npm dist-tag (defaults to latest).

```
fynpo publish --dist-tag next
```

**`--dry-run`**

When run with this option, `fynpo publish` does everything publish would do except actually publishing to the registry. Reports the details of what would have been published.

```
fynpo publish --dry-run
```

**`--no-push`**

By default, `fynpo publish` will push the release tag to git remote. Pass `--no-push` to disable this behavior.

```
fynpo publish --no-push
```




