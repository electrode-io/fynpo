# Record npm behaviors tested

## Resolve of `^` semver to `~`.

`package.json` dependencies layout:

```yml
top:
  foo-xa:
    bar: "~1.4.0"
  foo-xb:
    bar: "^1.4.0"
```

While `bar` has:

```
1.4.1
1.4.2
1.4.3
1.5.0
1.5.1
1.5.2
1.6.0
1.6.1
```

- `"~1.4.0"` can only resolve up to `1.4.3`
- `"^1.4.0"` can resolve up to `1.6.1`

### npm behavior

Tested with `npm@5.6.0` and `npm@6.4.1`. Same results:

With both `foo-xa` and `foo-xb`:

- `"~1.4.0"` is encountered first and resolve to `1.4.3`
- `"^1.4.0"` will resolve to the same `1.4.3`
- However, `npm` automatically sorts dependencies, because after moving `foo-xb` before `foo-xa`, `npm` still resolves both to `1.4.3`.

With `foo-xb` only:

- `"^1.4.0"` will resolve to the latest `1.6.1`
