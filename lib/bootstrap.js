"use strict";

/* eslint-disable no-magic-numbers */

const Promise = require("bluebird");
const Fs = require("fs");
const _ = require("lodash");
const ItemQueue = require("item-queue");
const VisualExec = require("./visual-exec");
const logger = require("./logger");

class Bootstrap {
  constructor(data) {
    this._data = data;
    data.ignores.forEach(x => {
      if (data.packages[x]) {
        data.packages[x].ignore = true;
      } else {
        logger.warn("Ignore package", x, "does not exist");
      }
    });
    this._failed = 0;
  }

  get failed() {
    return this._failed;
  }

  install(pkg, queue) {
    if (pkg.ignore) return true;
    if (pkg.installed === "pending") return false;
    if (pkg.installed) return true;

    let pending = 0;

    _.each(pkg.localDeps, depName => {
      if (!this.install(this._data.packages[depName], queue)) pending++;
    });

    if (pending === 0 && !pkg.installed) {
      queue.push(pkg);
      pkg.installed = "pending";
    }

    return false;
  }

  updatePkgToLocal(pkg) {
    if (pkg.ignore) return false;
    const json = pkg.pkgJson;
    if (!json) return false;
    let count = 0;
    ["dependencies", "devDependencies", "optionalDependencies"].forEach(sec => {
      const deps = json[sec];
      if (!deps) return;
      _.each(pkg.localDeps, depName => {
        if (!this._data.packages[depName].ignore && deps.hasOwnProperty(depName)) {
          count++;
          deps[depName] = `../${depName}`;
        }
      });
    });
    if (count > 0) {
      Fs.writeFileSync(pkg.pkgFile, `${JSON.stringify(json, null, 2)}\n`);
      return true;
    }
    return false;
  }

  restorePkgJson() {
    _.each(this._data.packages, pkg => {
      if (!pkg.ignore) Fs.writeFileSync(pkg.pkgFile, pkg.pkgStr);
    });
  }

  getMoreInstall() {
    const queue = [];

    _.each(this._data.packages, pkg => {
      this.install(pkg, queue);
    });

    return queue;
  }

  updateToLocal() {
    _.each(this._data.packages, pkg => {
      if (this.updatePkgToLocal(pkg)) {
        logger.info("Update package", pkg.name, "dependencies to local");
      }
    });
  }

  bootstrap() {
    _.each(this._data.packages, pkg => this.updatePkgToLocal(pkg));

    const itemQ = new ItemQueue({
      Promise,
      concurrency: 3,
      stopOnError: false,
      processItem: item => {
        const command = [`eval "$(fyn bash)"`, `fyn -q i install`];
        if (_.get(item, "pkgJson.scripts.prepublish")) command.push("npm run prepublish");
        if (_.get(item, "pkgJson.scripts.prepare")) command.push("npm run prepare");
        return new VisualExec({
          title: `bootstrap ${item.name}`,
          cwd: item.path,
          command: command.join(" && ")
        }).execute();
      },
      handlers: {
        doneItem: data => {
          if (data.item) data.item.installed = true;
          const items = this.getMoreInstall();
          itemQ.addItems(items, true);
        },
        done: () => this.restorePkgJson(),
        fail: () => {
          this._failed = 1;
        },
        failItem: () => {
          this._failed = 1;
          this.restorePkgJson();
        }
      }
    });

    return itemQ.addItems(this.getMoreInstall()).wait();

    // .then(() => {
    //   process.exit(failed);
    // })
    // .catch(err => {
    //   console.log(err);
    //   process.exit(1);
    // });
  }
}

module.exports = Bootstrap;
