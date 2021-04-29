---
id: commitlint
title: Versioning
---

The versioning of modules in fynpo mono repo are all automatically controlled by the commit messages. The default commitlint configuration supports commmit message in `[<semver>][feat|bug|chore] <message>` format, where:
   `<semver>` can be:

   - `major`
   - `minor`
   - `patch`
   - `chore`

The format of commit type can be modified by updating the below config:

```javaScript
parserPreset: {
    parserOpts: {
        headerPattern: /^\[([^\]]+)\] ?(\[[^\]]+\])? +(.+)$/,
        headerCorrespondence: ["type", "scope", "subject"],
    },
},
```

Refer [here](https://commitlint.js.org/#/reference-configuration) to read more about the supported configurations for commitlint.

#### Commit hooks:

To add commit hook,

```
# Install Husky
npm install husky --save-dev

# Active hooks
npx husky install

# Add hook
npx husky add .husky/commit-msg 'npx --no-install fynpo commitlint --edit $1'
```

**Note**: fynpo repo initialized using `create-fynpo` will alreday have `husky` added in `devDependencies` and also `husky install` added to the `prepare` script.

#### Test:

To test the simple usage,

```
echo '[test] msg' | npx fynpo commitlint
```

To test the hook,

```
git commit -m "[patch] message"
```