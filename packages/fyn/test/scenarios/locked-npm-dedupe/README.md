# Scenario

- scenario:

  `pkg A -> B@^1.0.0 and install B@1.0.0 in lockfile`

- User add to `package.json` `Pkg X -> new B@^1.1.0`

- Without dedupe, this cause B to have versions 1.0.0 and 1.1.0 installed

- This scenario uses package-lock.json that npm created with the above duplication

# Expect Behavior

Should detect indirect locked version got changed and de-dupe versions from npm lock data

# package-lock.json

npm's package-lock.json is generated:

1. make sure `mod-g` having only `3.0.0`
2. install with `mod-i@^1.0.0` as dependencies
3. add `mod-g` version `3.0.11`
4. `npm install mod-j@^1.0.0` which depends on `mod-g@^3.0.11`

> npm version used: 6.14.10
