"use strict";

const semverUtil = require("./util/semver");

/* eslint-disable no-magic-numbers, no-constant-condition */

/*
 * Dependency Item
 *
 * Contains info of a dependency and its dependencies
 *
 * Use to track fetching packages when resolving versions and dependencies
 *
 */

class DepItem {
  constructor(options, parent) {
    // name of the package
    this.name = options.name;
    // semver that was used to specify this dep
    this._semver = semverUtil.analyze(options.semver);
    // original top level package.json dep section (dep, dev, per, opt)
    //    dep - dependencies, dev: dev, opt: optional, per: peer
    this.src = options.src;
    // dsrc: source from the direct parent package
    this.dsrc = options.dsrc;
    // The version that was resolved
    this.resolved = options.resolved;
    // parent dependency item that pulled this
    this.parent = parent;
    this._shrinkwrap = options.shrinkwrap;
    this._deepRes = options.deepResolve;
    this._nested = {};
    // was this item promoted out of __fv_?
    this.promoted = undefined;
    this.depth = (parent && parent.depth + 1) || options.depth || 0;
  }

  get semver() {
    return this._semver.$;
  }

  get semverPath() {
    return this._semver.path;
  }

  set localType(type) {
    this._semver.localType = type;
  }

  get localType() {
    return this._semver.localType;
  }

  get urlType() {
    return this._semver.urlType;
  }

  get deepResolve() {
    return this._deepRes;
  }

  unref() {
    this.parent = undefined;
  }

  resolve(version, meta) {
    this.resolved = version;
    if (meta && meta.versions) {
      const pkg = meta.versions[version];
      this._shrinkwrap = pkg._shrinkwrap;
    }
  }

  get id() {
    return `${this.name}@${this.resolved}`;
  }

  _saveNestedRes(name, semver, version) {
    if (!this._nested[name]) {
      this._nested[name] = { _: [] };
    }
    if (!this._nested[name][semver]) {
      this._nested[name][semver] = version;
      if (this._nested[name]._.indexOf(version) < 0) {
        this._nested[name]._.push(version);
      }
    }
  }

  nestedResolve(name, semver) {
    if (this._nested.hasOwnProperty(name) && this._nested[name][semver]) {
      return this._nested[name][semver];
    }

    if (this._shrinkwrap && this._shrinkwrap.dependencies) {
      const x = this._shrinkwrap.dependencies[name];
      if (x && x.version && semverUtil.satisfies(x.version, semver)) {
        this._saveNestedRes(name, semver, x.version);
        return x.version;
      }
    }

    if (this._nested.hasOwnProperty(name)) {
      const found = this._nested[name]._.find(x => semverUtil.satisfies(x, semver));
      if (found) {
        this._saveNestedRes(name, semver, found);
        return found;
      }
    }

    if (this.parent) {
      return this.parent.nestedResolve(name, semver);
    }

    return undefined;
  }

  addResolutionToParent(data, firstKnown) {
    let pkg;

    if (this.parent.depth) {
      const x = this.parent;
      const kpkg = data.getPkg(x);
      pkg = kpkg[x.resolved].res;
    } else {
      pkg = data.res;
    }

    let depSection = pkg[this.dsrc];

    if (!depSection) {
      depSection = pkg[this.dsrc] = {};
    }
    depSection[this.name] = { semver: this.semver, resolved: this.resolved };

    // parent is not top
    if (this.parent.depth && !firstKnown) {
      this.parent._saveNestedRes(this.name, this.semver, this.resolved);
    }
  }

  get requestPath() {
    let x = this; // eslint-disable-line
    const reqPath = [];
    let opt = false;

    while (true) {
      if (x.parent.depth) {
        x = x.parent;
        if (x.dsrc === "opt") opt = true;
        reqPath.push(`${x.dsrc};${x.semver};${x.id}`);
      } else {
        if (x.dsrc === "opt") opt = true;
        reqPath.push(`${x.dsrc}`);
        break;
      }
    }

    return { opt, path: reqPath.reverse() };
  }

  addRequestToPkg(pkgV, firstSeen) {
    if (pkgV[this.src] === undefined) {
      pkgV[this.src] = 0;
    }
    pkgV[this.src]++;
    const reqPath = this.requestPath;
    pkgV.requests.push(reqPath.path);
    if (!pkgV._hasNonOpt) {
      pkgV._hasNonOpt = !reqPath.opt;
    }
    if (firstSeen) pkgV.firstReqIdx = pkgV.requests.length - 1;
    if (pkgV.dsrc.indexOf(this.dsrc) < 0) {
      pkgV.dsrc += `;${this.dsrc}`;
    }
    if (pkgV.src.indexOf(this.src) < 0) {
      pkgV.src += `;${this.src}`;
    }
  }

  isCircular() {
    let parent = this.parent;
    const id = this.id;

    while (parent.depth) {
      if (parent.id === id) return true;
      parent = parent.parent;
    }

    return false;
  }
}

module.exports = DepItem;
