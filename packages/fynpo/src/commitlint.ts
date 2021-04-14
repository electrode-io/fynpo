/* eslint-disable consistent-return, no-shadow, @typescript-eslint/no-var-requires */

import stdin from "get-stdin";
import * as utils from "./utils";
import Path from "path";
import logger from "./logger";
import _ from "lodash";
import resolveFrom from "resolve-from";
import resolveGlobal from "resolve-global";
import resolveExtends from "@commitlint/resolve-extends";
import executeRule from "@commitlint/execute-rule";
import lint from "@commitlint/lint";
import read from "@commitlint/read";

export interface LoadOptions {
  cwd?: string;
  file?: string;
}

export default class Commitlint {
  _cwd;
  _options;
  name;
  _config;

  constructor(opts) {
    this.name = "commitlint";

    this._cwd = opts.cwd;
    const { fynpoRc, dir } = utils.loadConfig(this._cwd);
    this._cwd = dir || opts.cwd;
    this._config = fynpoRc || {};

    const commandConfig = (this._config as any).command || {};
    const overrides = commandConfig[this.name] || {};
    this._options = _.defaults(opts, overrides, this._config);
  }

  pickLintFields(config = {}) {
    return _.pick(
      config,
      "extends",
      "rules",
      "plugins",
      "parserPreset",
      "formatter",
      "ignores",
      "defaultIgnores",
      "helpUrl"
    );
  }

  mergeCustomizer = (obj, src) => (Array.isArray(src) ? src : undefined);

  async loadLintParserOpts(parserName: string, pendingParser: Promise<any>) {
    // Await for the module, loaded with require
    const parser = await pendingParser;

    // Await parser opts if applicable
    if (
      typeof parser === "object" &&
      typeof parser.parserOpts === "object" &&
      typeof parser.parserOpts.then === "function"
    ) {
      return (await parser.parserOpts).parserOpts;
    }

    // Create parser opts from factory
    if (
      typeof parser === "object" &&
      typeof parser.parserOpts === "function" &&
      parserName.startsWith("conventional-changelog-")
    ) {
      return await new Promise((resolve) => {
        const result = parser.parserOpts((_: never, opts: { parserOpts: any }) => {
          resolve(opts.parserOpts);
        });

        // If result has data or a promise, the parser doesn't support factory-init
        // due to https://github.com/nodejs/promises-debugging/issues/16 it just quits, so let's use this fallback
        if (result) {
          Promise.resolve(result).then((opts) => {
            resolve(opts.parserOpts);
          });
        }
      });
    }

    // Pull nested paserOpts, might happen if overwritten with a module in main config
    if (
      typeof parser === "object" &&
      typeof parser.parserOpts === "object" &&
      typeof parser.parserOpts.parserOpts === "object"
    ) {
      return parser.parserOpts.parserOpts;
    }

    return parser.parserOpts;
  }

  loadFormatter(config, options) {
    const moduleName = options.format || config.formatter || "@commitlint/format";
    const modulePath =
      resolveFrom.silent(__dirname, moduleName) ||
      resolveFrom.silent(options.cwd, moduleName) ||
      resolveGlobal.silent(moduleName);

    if (modulePath) {
      const moduleInstance = require(modulePath);

      if (_.isFunction(moduleInstance.default)) {
        return moduleInstance.default;
      }

      return moduleInstance;
    }

    logger.error(`Using format ${moduleName}, but cannot find the module.`);
    process.exit(1);
  }

  selectParserOpts(parserPreset) {
    if (typeof parserPreset !== "object") {
      return undefined;
    }

    if (typeof parserPreset.parserOpts !== "object") {
      return undefined;
    }

    return parserPreset.parserOpts;
  }

  async load(options: LoadOptions = {}) {
    const loaded = options.file
      ? utils.loadFynpoConfig(options.cwd, options.file)
      : { config: this._config.commitlint, filepath: undefined };

    const base = loaded && loaded.filepath ? Path.dirname(loaded.filepath) : this._cwd;
    const config = this.pickLintFields(loaded.config);
    const opts = _.merge(
      { extends: [], rules: {}, formatter: "@commitlint/format" },
      _.pick(config, "extends", "plugins", "ignores", "defaultIgnores")
    );

    // Resolve parserPreset key
    if (typeof config.parserPreset === "string") {
      const resolvedParserPreset = resolveFrom(base, config.parserPreset);

      config.parserPreset = {
        name: config.parserPreset,
        path: resolvedParserPreset,
        parserOpts: require(resolvedParserPreset),
      };
    }

    // Resolve extends key
    const extended = resolveExtends(opts, {
      prefix: "commitlint-config",
      cwd: base,
      parserPreset: config.parserPreset,
    });

    const preset = this.pickLintFields(_.mergeWith(extended, config, this.mergeCustomizer)) as any;
    preset.plugins = {};

    // Resolve parser-opts from preset
    if (typeof preset.parserPreset === "object") {
      preset.parserPreset.parserOpts = await this.loadLintParserOpts(
        preset.parserPreset.name,
        preset.parserPreset as any
      );
    }

    // Resolve config-relative formatter module
    if (typeof config.formatter === "string") {
      preset.formatter = resolveFrom.silent(base, config.formatter) || config.formatter;
    }

    // To-Do : plugins

    const rules = preset.rules ? preset.rules : {};
    const qualifiedRules = (
      await Promise.all(Object.entries(rules || {}).map((entry) => executeRule<any>(entry)))
    ).reduce((registry, item) => {
      const [key, value] = item as any;
      (registry as any)[key] = value;
      return registry;
    }, {});

    const helpUrl =
      typeof config.helpUrl === "string"
        ? config.helpUrl
        : "https://github.com/conventional-changelog/commitlint/#what-is-commitlint";

    return {
      extends: preset.extends!,
      formatter: preset.formatter!,
      parserPreset: preset.parserPreset!,
      ignores: preset.ignores!,
      defaultIgnores: preset.defaultIgnores!,
      plugins: preset.plugins!,
      rules: qualifiedRules,
      helpUrl,
    };
  }

  async exec() {
    const isEdit = Boolean(this._options.edit);
    const input = await (isEdit
      ? read({
          edit: this._options.edit,
          cwd: this._cwd,
        })
      : stdin());

    const messages = (Array.isArray(input) ? input : [input])
      .filter((message) => typeof message === "string")
      .filter((message) => message.trim() !== "")
      .filter(Boolean);
    if (messages.length === 0) {
      logger.error("input is required.");
      process.exit(1);
    }

    const loaded = await this.load({
      cwd: this._cwd,
      file: this._options.config,
    });

    const parserOpts = this.selectParserOpts(loaded.parserPreset);
    const opts = {
      parserOpts: {},
      plugins: {},
      ignores: [],
      defaultIgnores: true,
    };

    if (parserOpts) {
      opts.parserOpts = parserOpts;
    }

    /*if (loaded.plugins) {
      opts.plugins = loaded.plugins;
    }*/

    if (loaded.ignores) {
      opts.ignores = loaded.ignores;
    }
    if (loaded.defaultIgnores === false) {
      opts.defaultIgnores = false;
    }

    const format = this.loadFormatter(loaded, { cwd: this._cwd });
    const results = await Promise.all(messages.map((message) => lint(message, loaded.rules, opts)));

    if (Object.keys(loaded.rules).length === 0) {
      let input = "";

      if (results.length !== 0) {
        input = results[0].input;
      }

      results.splice(0, results.length, {
        valid: false,
        errors: [
          {
            level: 2,
            valid: false,
            name: "empty-rules",
            message: [
              "Please add rules to your `commitlint.config.js`",
              "    - Getting started guide: https://git.io/fhHij",
              "    - Example config: https://git.io/fhHip",
            ].join("\n"),
          },
        ],
        warnings: [],
        input,
      });
    }

    const report = results.reduce(
      (info, result) => {
        info.valid = result.valid ? info.valid : false;
        info.errorCount += result.errors.length;
        info.warningCount += result.warnings.length;
        info.results.push(result);

        return info;
      },
      {
        valid: true,
        errorCount: 0,
        warningCount: 0,
        results: [],
      }
    );

    const helpUrl = loaded.helpUrl;
    const output = format(report, {
      color: this._options.color,
      verbose: this._options.verbose,
      helpUrl,
    });

    console.log(output);
    if (!report.valid) {
      process.exit(1);
    }
  }
}
