# Scenario

* package.json dep has semver locked to version
* package.json semver changes and locked version no longer satisfies it

# Expect Behavior

* Update version to the latest one that satisfies new semver
* Update locked version
* Install new version
* Delete old version
