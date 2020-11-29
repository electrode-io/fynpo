# Scenario

- A secondary dep locked to a version (such as 1.0.1)
- package.json adds the secondary dep and resolves to a newer version (such as 1.0.2)

# Expect Behavior

- Detect multiple versions resolving and partially refresh lock for a dep
