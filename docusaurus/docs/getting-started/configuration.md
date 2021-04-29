---
id: configuration
title: Configuration
---


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
### changeLogMarkers
The markers used to list the changed packages and corresponding commit messages in CHANGELOG.md. This will be used by `fynpo prepare` command to detect the changed packages.

### command.bootstrap.npmRunScripts
npm scripts to run for each package while bootstrapping them. Its recommended to `build` all the packages while bootstrapping for the local package linking to work properly.

### command.publish.tags
To publish to npm with the given npm dist-tag. Users can specify different tags for different packages and also enable/disable tags for individual or multiple packages.

```javascript
  command: {
    publish: {
      tags: {
        tag1: {
          enabled: true, // set false to disable this tag
          packages: {
            "pkg1": true,
            "pkg2": false, // disable tag for pkg2
          },
          addToVersion: true,
        },
        tag2: {
          enabled: true,
          packages: {
            "pkg3": true,
          },
          addToVersion: false,
        },
      },
    },
  }
```

- Above config will add the tag `tag1` to `publishConfig` of `pkg1` and `tag2` to `publishConfig` of `pkg3`.
- `addToVersion` - If enabled, will add the tag name to package version. Example - `1.0.0-tag1.0`

### command.publish.versionTagging
To add `ver[pkgVerison]` as `dist-tag`.

```javascript
command: {
    publish: {
      versionTagging: {
        pkg4: true
      }
    }
}
```

if current version of `pkg4` is `1.0.0`, the above config will add the tag `ver1` to `publishConfig` of `pkg4`.

### forcePublish
List of packages to be force published. Use `*` for all packages.

To force publish all the packages, 

```javascript
{
  forcePublish: ["*"]
}
```

To force publish selected packages,

```javascript
{
  forcePublish: ["pkg1", "pkg2"] 
}
```

### ignoreChanges
Ignore changes in files matched by glob(s) when detecting changed packages.

```javascript
{
  "ignoreChanges": ["**/__tests__/**", "**/*.md"]
}
```

### versionLocks
Group of packages to be version locked together. Use ['*'] to lock the verisons of all the packages together.

Lock versions of all packages:

```javascript
{
  "versionLocks": ["*"]
}
```

Lock versions of selected packages:

```javascript
{
  "versionLocks": [["pkg1", "pkg3"], ["pkg2", "pkg4"]]
}
```
Here pkg1, pkg3 are version locked and pkg2, pk4 are verison locked together.

### commitlint
commit lint configuration. Refer [here](https://commitlint.js.org/#/reference-configuration) for the details of supported configurations.



