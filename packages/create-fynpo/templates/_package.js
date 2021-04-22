"use strict";

module.exports = (base, merge) => {
  const pkg = {
    name: "root",
    version: "0.0.1",
    private: true,
    description: "",
    homepage: "",
    scripts: {
      bootstrap: "fynpo",
      build: "fynpo run build",
      test: "fynpo run test",
      clean: "npm run nuke && npm run nuke-packages",
      nuke: "rm -rf node_modules fynpo-debug.log fyn-lock.yaml",
      "nuke-packages":
        "rm -rf packages/*/node_modules packages/*/fyn-lock.yaml",
    },
    author: {
      name: "",
      email: "",
      url: "",
    },
    contributors: [],
    repository: {
      type: "git",
      url: "",
    },
    license: "UNLICENSED",
    devDependencies: {
      fynpo: "^0.3.0",
      prettier: "^2.2.1",
    },
    prettier: {
      printWidth: 100,
    },
  };

  return merge({}, pkg, base);
};
