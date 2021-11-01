const { eslintRcTestTypeScript } = require("@xarc/module-dev");
module.exports = {
  extends: eslintRcTestTypeScript,
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
      },
    ],
  },
};
