# Scenario

- scenario:

  `pkg A -> B@^1.0.0 and install B@1.0.0 in lockfile`

- User add to `package.json` `Pkg X -> new B@^1.1.0`

- Without dedupe, this cause B to have versions 1.0.0 and 1.1.0 installed

# Expect Behavior

Should detect indirect locked version got changed and dedupe versions
