"use strict";

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
    this.semver = options.semver;
    // original top level package.json dep section (dep, dev, per, opt)
    //    dep - dependencies, dev: dev, opt: optional, per: peer
    this.src = options.src;
    // dsrc: source from the direct parent package
    this.dsrc = options.dsrc;
    // The version that was resolved
    this.resolved = options.resolved;
    // parent dependency item that pulled this
    this.parent = parent;
    // was this item promoted out of __fv_?
    this.promoted = undefined;
  }

  unref() {
    this.parent = undefined;
  }

  resolve(version) {
    this.resolved = version;
  }

  get id() {
    return `${this.name}@${this.resolved}`;
  }

  addResolutionToParent(data) {
    let pkg;
    if (this.parent) {
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
  }

  get requestPath() {
    let x = this; // eslint-disable-line
    const request = [];

    while (true) {
      if (x.parent) {
        x = x.parent;
        request.push(`${x.dsrc};${x.semver};${x.id}`);
      } else {
        request.push(`${x.dsrc}`);
        break;
      }
    }

    return request.reverse();
  }

  addRequestToPkg(pkgV, firstSeen) {
    if (pkgV[this.src] === undefined) {
      pkgV[this.src] = 0;
    }
    pkgV[this.src]++;
    pkgV.requests.push(this.requestPath);
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

    while (parent) {
      if (parent.id === id) return true;
      parent = parent.parent;
    }

    return false;
  }
}

module.exports = DepItem;
