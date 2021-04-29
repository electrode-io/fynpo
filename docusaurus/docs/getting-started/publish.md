---
id: publish
title: Publish Flow
---

1. Run `fynpo changelog` to detect changed packages and determine version bumps.

    - Identifies the package that have been changed since last release
    - Determine version bumps based on the commit message
    - Add tags to versions, if enabled (command.publish.tags)
    - Update CHANGELOG.md file
    - Commits changes to CHANGELOG.md file

2. Run `fynpo prepare` to modify package metadata to reflect new release.

    - Read changed packages and their versions from CHANGELOG.md
    - Update `package.json` with new versions
    - Update npm tag in package.json, if enabled (command.publish.tags, command.publish.versionTagging)
    - Update versions of changed local dependencies
    - Commit the changes and tag the commits, if enabled

3. Run `fynpo publish` to publish packages updated since last release.

    - Detect the packages changed in `prepare` step
    - Publish the packages to the specified npm registry
    - tag the commit with release tag
    - push the tag to git remote
