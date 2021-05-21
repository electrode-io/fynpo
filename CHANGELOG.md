# 5/21/2021

-   [patch] allow file to turn off fyn generating source maps

## Packages

-   `fyn@0.4.32` `(0.4.31 => 0.4.32)`

## Commits

-   `packages/fynpo-base`

    -   [chore] update dep publish-util [commit](https://github.com/electrode-io/fynpo/commit/5eed0fead5e9b5c014d039efc22e7f98184d3066)

-   `packages/create-fynpo`

    -   [chore] update dep publish-util [commit](https://github.com/electrode-io/fynpo/commit/5eed0fead5e9b5c014d039efc22e7f98184d3066)

-   `packages/fyn`

    -   [patch] allow file to turn off fyn generating source maps ([#19](https://github.com/electrode-io/fynpo/pull/19)) [commit](https://github.com/electrode-io/fynpo/commit/ac241b328dac08c3f31a9acf82c7f56272d90c1b)
    -   [chore] update dep publish-util [commit](https://github.com/electrode-io/fynpo/commit/5eed0fead5e9b5c014d039efc22e7f98184d3066)
    -   [chore] fix npm publish issue with prepack script [commit](https://github.com/electrode-io/fynpo/commit/735af8fb026061297d5b3c6876ebd382d7392c47)

-   `packages/fynpo`

    -   [chore] update dep publish-util [commit](https://github.com/electrode-io/fynpo/commit/5eed0fead5e9b5c014d039efc22e7f98184d3066)

-   `MISC`

    -   [chore] update fynpo to 0.4.1 [commit](https://github.com/electrode-io/fynpo/commit/4bab8320766901ed3f59644240354adbf9fe4240)

# 5/20/2021

- [patch] fyn support generating source map back to original file
- [patch] fynpo adjust logging to help some build systems

## Packages

- `fyn@0.4.30` `(0.4.29 => 0.4.30)`
- `fynpo@0.4.1` `(0.4.0 => 0.4.1)`

## Commits

- `packages/fynpo-base`

  - [chore] add ci:check script [commit](https://github.com/electrode-io/fynpo/commit/68b794e8d7fc174a65c0a6b98885bdbf374d6471)

- `packages/fyn`

  - [patch] improving source map rewriting and generation ([#18](https://github.com/electrode-io/fynpo/pull/18)) [commit](https://github.com/electrode-io/fynpo/commit/78d143305440761030fca12813b182389ade477f)
  - [patch] fyn support generating source map back to original file ([#16](https://github.com/electrode-io/fynpo/pull/16)) [commit](https://github.com/electrode-io/fynpo/commit/313e94f63560b9f3d96dc28c7ec6a795edd5a883)
  - transferred into mono-repo

- `packages/fynpo`

  - [patch] fynpo adjust logging to help some build systems ([#17](https://github.com/electrode-io/fynpo/pull/17)) [commit](https://github.com/electrode-io/fynpo/commit/51103b989316c74302ad60cf4420fc843c2c42b4)
  - [chore] update license and readme etc [commit](https://github.com/electrode-io/fynpo/commit/8cb9578a68e854e8a41c0490aa22061bf6d3a64e)
  - [chore] prettier@2.3.0 ([#36](https://github.com/electrode-io/fynpo/pull/36)) [commit](https://github.com/electrode-io/fynpo/commit/9c32d8f8fc654a6db1709a28e01deb3b3df4b77e)
  - [chore] add ci:check script [commit](https://github.com/electrode-io/fynpo/commit/68b794e8d7fc174a65c0a6b98885bdbf374d6471)

- `packages/fynpo-cli`

  - [chore] add ci:check script [commit](https://github.com/electrode-io/fynpo/commit/68b794e8d7fc174a65c0a6b98885bdbf374d6471)

- `.github`

  - [chore] update github workflow branch [commit](https://github.com/electrode-io/fynpo/commit/cbdf7272d8dee44d6518d7d04d222ce3520fa177)
  - Create node.js.yml [commit](https://github.com/electrode-io/fynpo/commit/3ce3e756a07507f87c492d998646b549992f575e)

- `MISC`

  - [chore] update README [commit](https://github.com/electrode-io/fynpo/commit/e798240429f6e1429663c7ca8d25068788c99dbd)
  - [chore] update dep fynpo [commit](https://github.com/electrode-io/fynpo/commit/b5bb13f27bc916b2fa2977707f625debacfde69e)

# 5/17/2021

- fynpo-base module for common code
- [minor] prepare fynpo-base for release
- [patch] fix run command
- [patch] fynpo publish fixes
- [patch] fynpo improve run logs
- [patch] fynpo uses fynpo-base
- [chore] update publish info

## Packages

- `@fynpo/base@0.1.0` `(0.0.1 => 0.1.0)`
- `create-fynpo@1.0.4` `(1.0.3 => 1.0.4)`
- `fynpo@0.4.0` `(0.3.2 => 0.4.0)`
- `fynpo-cli@1.0.2` `(1.0.1 => 1.0.2)`

## Commits

- `packages/fynpo-base`

  - [minor] prepare fynpo-base for release [commit](https://github.com/electrode-io/fynpo/commit/35de764c3acab816c0ff8d8cf33d2f4a5d13b7a1)
  - [patch] fynpo publish fixes ([#34](https://github.com/electrode-io/fynpo/pull/34)) [commit](https://github.com/electrode-io/fynpo/commit/c614ad5bd72ebbc0112f4fa2c97c2a09b4b13304)
  - fynpo-base module for common code ([#31](https://github.com/electrode-io/fynpo/pull/31)) [commit](https://github.com/electrode-io/fynpo/commit/a5c2cb73297fe55197e53ce2e0258a072ff5a9a3)

- `packages/create-fynpo`

  - [chore] update publish info [commit](https://github.com/electrode-io/fynpo/commit/176737ea80a1b087589b40b6c51fee8ee3ed6af8)
  - create-fynpo@1.0.3 [commit](https://github.com/electrode-io/fynpo/commit/ba06d91241afec9794f9a4af7fc1facac6615829)
  - Add README to create-fynpo pckage ([#26](https://github.com/electrode-io/fynpo/pull/26)) [commit](https://github.com/electrode-io/fynpo/commit/21e3bbcafd6bde19f5b87bbfdd7c2d663ec2bf85)
  - create-fynpo@1.0.2 [commit](https://github.com/electrode-io/fynpo/commit/2de3ab4c5baab5373ef09bf053c7a2d58bc1b95f)
  - create-fynpo@1.0.1 [commit](https://github.com/electrode-io/fynpo/commit/fd3167810cc31361206c7a47f2a48ded7187154e)
  - fix: create-fynpo copy packages ([#25](https://github.com/electrode-io/fynpo/pull/25)) [commit](https://github.com/electrode-io/fynpo/commit/bc0ad387f731743a6eabab47080f720626369606)
  - create-fynpo package ([#23](https://github.com/electrode-io/fynpo/pull/23)) [commit](https://github.com/electrode-io/fynpo/commit/2aaf32a66ce0b055d25d7e2e10941ef5b2c30dfd)

- `packages/fynpo`

  - [minor] prepare fynpo-base for release [commit](https://github.com/electrode-io/fynpo/commit/35de764c3acab816c0ff8d8cf33d2f4a5d13b7a1)
  - [patch] fix run command ([#35](https://github.com/electrode-io/fynpo/pull/35)) [commit](https://github.com/electrode-io/fynpo/commit/672d617924e06d09b98ed89e5e685236ef7a60d0)
  - [patch] fynpo publish fixes ([#34](https://github.com/electrode-io/fynpo/pull/34)) [commit](https://github.com/electrode-io/fynpo/commit/c614ad5bd72ebbc0112f4fa2c97c2a09b4b13304)
  - [patch] fynpo improve run logs ([#33](https://github.com/electrode-io/fynpo/pull/33)) [commit](https://github.com/electrode-io/fynpo/commit/1b47d41667ced80b41f29a66de413d29d0822dcb)
  - [patch] fynpo uses fynpo-base ([#32](https://github.com/electrode-io/fynpo/pull/32)) [commit](https://github.com/electrode-io/fynpo/commit/17a70494faff557eabfb706059dc0b0000c75ad1)
  - [chore] update publish info [commit](https://github.com/electrode-io/fynpo/commit/176737ea80a1b087589b40b6c51fee8ee3ed6af8)

- `packages/fynpo-cli`

  - [chore] update publish info [commit](https://github.com/electrode-io/fynpo/commit/176737ea80a1b087589b40b6c51fee8ee3ed6af8)
  - fynpo-cli@1.0.1 [commit](https://github.com/electrode-io/fynpo/commit/e4fcbfe79480710ef047a3dd95512e07d883c509)
  - Global fynpo command ([#22](https://github.com/electrode-io/fynpo/pull/22)) [commit](https://github.com/electrode-io/fynpo/commit/320924df51d9c12068473127deed721c6f83e11c)
  - Typescript conversion, added tests ([#1](https://github.com/electrode-io/fynpo/pull/1)) [commit](https://github.com/electrode-io/fynpo/commit/5e7abb79f18a4db27b59934e2106303054866e9e)
  - add fynpo-cli [commit](https://github.com/electrode-io/fynpo/commit/0204ba84232775b001043a209f77d8d6a2c4b6f4)

- `docusaurus`

  - doc updates ([#30](https://github.com/electrode-io/fynpo/pull/30)) [commit](https://github.com/electrode-io/fynpo/commit/acde2eed6843c4acd55e77102ce655690303c3eb)
  - docusaurus guide ([#29](https://github.com/electrode-io/fynpo/pull/29)) [commit](https://github.com/electrode-io/fynpo/commit/db3ee8151a2d862b78f05e18dd37b2a25e760aea)
