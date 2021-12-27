import Enquirer from "enquirer";
import _ from "lodash";
import Fs from "fs";
import Path from "path";
import semver from "semver";

function sortObj(obj: any) {
  const out = {};
  const sortedKeys = Object.keys(obj)
    .sort()
    .forEach((x) => {
      out[x] = obj[x];
    });
  return out;
}

function mergeReplaceArray(objValue, srcValue) {
  if (_.isArray(objValue)) {
    return srcValue;
  }
}

/**
 *
 */
// @ts-ignore
class SAutoComplete extends Enquirer.AutoComplete {
  focused: any;
  constructor(options) {
    super(options);
  }

  submit() {
    if (!this.focused) {
      // @ts-ignore
      Enquirer.Prompt.prototype.submit.call(this);
    } else {
      super.submit();
    }
  }
}

const initialTemplate = {
  name: "",
  version: "1.0.0",
  description: "",
  main: "index.js",
  exports: null, // place holder
  homepage: "",
  license: "UNLICENSED",
  scripts: {
    test: 'echo "Error: no test specified" && exit 1',
  },
  bin: null, // place holder
  private: false,
  author: "",
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.com/",
  },
  files: ["src", "lib", "dist"],
  keywords: [],
  repository: {
    type: "git",
    url: "",
  },
};

/**
 *
 * @param base
 * @returns
 */
async function enquireAnswers(base: any) {
  const enquirer = new Enquirer();

  // @ts-ignore
  enquirer.register("sauto", SAutoComplete);

  let name = base.name;

  const licenses = [
    "UNLICENSED",
    "ISC",
    "MIT",
    "Apache-2.0",
    "BSD-3-Clause",
    "BSD-2-Clause",
    "GPL-2.0",
    "GPL-3.0",
    "LGPL-2.1",
    "LGPL-3.0",
    "MPL-2.0",
    "CDDL-1.0",
    "EPL-2.0",
  ];

  if (!licenses.includes(base.license)) {
    licenses.unshift(base.license);
  }

  const prompts: any = [
    {
      type: "input",
      name: "name",
      initial: base.name,
      message: "name:",
      validate: (x) => {
        name = x;
        return true;
      },
    },

    {
      type: "input",
      name: "version",
      initial: base.version,
      message: "version:",
      validate(value) {
        if (!semver.valid(value)) {
          return "version should be a valid semver value - https://docs.npmjs.com/cli/v8/configuring-npm/package-json#version";
        }
        return true;
      },
    },

    {
      type: "input",
      name: "description",
      initial: base.description,
      message: "description:",
    },

    {
      type: "input",
      name: "main",
      initial: base.main,
      message: "main entry:",
      skip: Boolean(_.get(base, "exports")),
    },

    {
      type: "input",
      name: "homepage",
      initial: base.homepage,
      message: "homepage:",
    },

    {
      type: "input",
      name: "scripts.test",
      initial: _.get(base, "scripts.test"),
      skip: true,
    },

    {
      type: "input",
      name: "repository.type",
      initial: _.get(base, "repository.type"),
      skip: true,
    },

    {
      type: "input",
      name: "repository.url",
      initial: _.get(base, "repository.url"),
      message: "git repository url:",
    },

    {
      type: "input",
      name: "author",
      initial: base.author,
      message: "author:",
    },

    {
      type: "sauto",
      name: "license",
      initial: base.license,
      choices: licenses,
      message:
        "license (See more at https://opensource.org/licenses or https://spdx.org/licenses):",
    },

    {
      type: "list",
      name: "keywords",
      initial: []
        .concat(base.keywords)
        .filter((x) => x)
        .join(","),
      message: "keywords - separate with commas",
    },
    {
      type: "list",
      name: "files",
      initial: []
        .concat(base.files)
        .filter((x) => x)
        .join(","),
      message: "files - separate with commas",
    },

    {
      type: "sauto",
      name: "publishConfig.access",
      choices: ["public", "restricted"],
      initial: _.get(base, "publishConfig.access"),
      message: "publish access",
      skip: () => {
        return !name.startsWith("@");
      },
    },

    {
      type: "toggle",
      name: "private",
      initial: base.private,
      enabled: "Yes",
      disabled: "No",
      message: "private",
    },
  ];

  const answers: any = await enquirer.prompt(prompts);

  return answers;
}

/**
 *
 * @param yes
 * @param template
 * @param exist
 * @returns
 */
export async function generateNpmPackage(
  yes = false,
  template: any = initialTemplate,
  exist: any = {}
) {
  const base = _.mergeWith({}, template, exist, mergeReplaceArray);

  let answers: any;
  if (!yes) {
    answers = await enquireAnswers(base);
  } else {
    answers = _.mergeWith({}, template, exist, mergeReplaceArray);
  }

  if (!answers.private) {
    delete answers.private;
  }

  if (_.get(exist, "scripts")) {
    delete answers.scripts;
  }

  if (_.get(exist, "exports")) {
    delete answers.main;
  }

  if (_.get(exist, "publishConfig") || !answers.name.startsWith("@")) {
    delete answers.publishConfig;
  }

  const finalData = _.mergeWith({}, exist, answers, mergeReplaceArray);

  //
  // ensure order for basic fields
  //
  const result: any = {};
  Object.keys(template).forEach((k) => {
    if (finalData[k] === null) {
      delete finalData[k];
    } else if (finalData.hasOwnProperty(k)) {
      result[k] = finalData[k];
      delete finalData[k];
    }
  });
  Object.assign(result, finalData);
  result.files = result.files.map((x) => x.trim());

  return result;
}

/**
 *
 * @param yes
 * @param cwd
 * @returns
 */
export async function initNpmPackage(yes = false, cwd = process.cwd()) {
  let exist: any;

  const file = Path.join(cwd, "package.json");
  let template = initialTemplate;
  try {
    const data = await Fs.promises.readFile(file, "utf-8");
    exist = JSON.parse(data);
  } catch {
    const name1 = Path.basename(cwd);
    const name2 = Path.basename(Path.dirname(cwd));
    const name = name2 && name2.startsWith("@") ? `${name2}/${name1}` : name1;

    template = Object.assign({}, initialTemplate, { name });
  }

  const result = await generateNpmPackage(yes, template, exist);

  const outputData = JSON.stringify(result, null, 2);
  let changed = true;
  let updated = true;
  if (exist) {
    const sortExistData = JSON.stringify(sortObj(exist));
    const sortResultData = JSON.stringify(sortObj(result));
    changed = sortExistData !== sortResultData;
    const existData = JSON.stringify(exist, null, 2);
    updated = existData !== outputData;
  }

  if (updated) {
    await Fs.promises.writeFile(file, `${outputData}\n`);
  }

  return { exist, result, outputData, changed, updated };
}

/**
 *
 * @param cwd
 * @param yes
 */
export async function runInitPackage(yes = false, cwd = process.cwd()) {
  if (!yes) {
    // some message copied from original "npm init"
    console.log(`This utility will walk you through creating a package.json file.
It only covers the most common items, and tries to guess sensible defaults.

For more details, see:
  https://docs.npmjs.com/cli/v8/configuring-npm/package-json

Press ^C at any time to quit.`);
  }
  const { exist, outputData, changed, updated } = await initNpmPackage(yes, cwd);
  if (updated) {
    console.log(`Wrote to ${process.cwd()}/package.json`);
    if (!changed) {
      console.log(`No actual value changed, only reordered some keys`);
    }
    if (!exist) {
      console.log(outputData);
    }
  } else {
    console.log(`No changes made to your package.json`);
  }
}
