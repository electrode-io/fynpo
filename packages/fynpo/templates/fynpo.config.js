"use strict";

module.exports = {
  changeLogMarkers: ["## Packages", "## Commits"],
  command: { publish: { tags: {}, versionTagging: {} } },
  commitlint: {
    extends: ["@commitlint/config-conventional"],
    parserPreset: {
      parserOpts: {
        headerPattern: /^\[([^\]]+)\] ?(\[[^\]]+\])? +(.+)$/,
        headerCorrespondence: ["type", "scope", "subject"],
      },
    },
    rules: { "type-enum": [2, "always", ["patch", "minor", "major", "chore"]] },
    ignores: [
      (commit) =>
        commit.startsWith("[Publish]") || commit.includes("Update changelog"),
    ],
    defaultIgnores: true,
    helpUrl:
      "https://github.com/conventional-changelog/commitlint/#what-is-commitlint",
  },
};
