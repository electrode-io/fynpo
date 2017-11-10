# fyn: Flatten Your NodeModules

fyn is a node package manager for the [flat node_modules design here].

# Features

-   Dependencies information retained and checked at runtime.
-   Your application will not silently load bad dependencies.
-   Always deterministic node_modules installation.
-   Super fast performance.
-   **_The best version lock bar none._**
-   Support locking module meta versions.
-   Generate super detailed stats of your dependencies.
-   Multiple but related modules development that just works.

# Meta Versions Lock

fyn automatically saves the meta versions data after an install.  Next time you install again it will use the same meta versions and you will get the exact same versions of modules.

To get newer versions of your dependencies, you can:

-   Remove all the meta data and install all packages that have updates.
-   Selectively remove the meta for any packages and have only those updated.

[flat node_modules design here]: https://github.com/jchip/node-flat-module
