"use strict";

/* eslint-disable */
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
    this.semver = options.semver;
    // original top level package.json dep section (dep, dev, per, opt)
    //    dep - dependencies, dev: dev, opt: optional, per: peer
    this.src = options.src;
    // dsrc: source from the direct parent package
    this.dsrc = options.dsrc;
    // The version that was resolved
    this.resolved = options.resolved;
    // parent dependency item that pulled this
    if (parent) {
      this.request = parent.request.concat(parent.makeRequestEntry());
      this.parent = parent;
    } else {
      this.request = [`${this.src}`];
      this.res = {};
    }
    // was this item promoted out of __fv_?
    this.promoted = undefined;
  }

  makeRequestEntry() {
    return `${this.dsrc};${this.name};${this.semver};${this.resolved}`;
  }

  addResolutionToParent(data) {
    let pkg;
    if (this.parent) {
      const x = this.parent;
      const kpkg = data.pkgs[x.name];
      pkg = kpkg[x.resolved].res;
    } else {
      pkg = data.res;
    }
    let depSection = pkg[this.dsrc];
    if (!depSection) {
      depSection = pkg[this.dsrc] = {};
    }
    depSection[this.name] = { semver: this.semver, resolved: this.resolved };
  }

  addRequestToPkg(pkgV) {
    if (pkgV[this.src] === undefined) {
      pkgV[this.src] = 0;
    }
    pkgV[this.src]++;
    this.request.push(`${this.dsrc};${this.semver}`);
    pkgV.requests.push(this.request);
    if (pkgV.dsrc.indexOf(this.dsrc) < 0) {
      pkgV.dsrc += `;${this.dsrc}`;
    }
    if (pkgV.src.indexOf(this.src) < 0) {
      pkgV.src += `;${this.src}`;
    }
  }
}

module.exports = DepItem;
