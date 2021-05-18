"use strict";

/* eslint-disable global-require, prefer-template */

const Fs = require("./util/file-ops");
const PkgBinLinkerBase = require("./pkg-bin-linker-base");

//
// Look at each promoted package and link their bin to node_modules/.bin
// TODO: only do this for packages in package.json [*]dependencies
//

const CYGWIN_LINK = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")

case \`uname\` in
    *CYGWIN*) basedir=\`cygpath -w "$basedir"\`;;
esac

if [ -x "$basedir/node" ]; then
  "$basedir\\node"  "$basedir\\{{TARGET}}" "$@"
  ret=$?
else
  node  "$basedir\\{{TARGET}}" "$@"
  ret=$?
fi
exit $ret
`;

const CMD_BATCH = `@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\{{TARGET}}" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\{{TARGET}}" %*
)
`;

class PkgBinLinkerWin32 extends PkgBinLinkerBase {
  constructor(options) {
    super(options);
  }

  //
  // Platform specific
  //

  async _ensureGoodLink(symlink, target) {
    try {
      const existTarget = (await Fs.readFile(symlink)).toString();
      if (existTarget.indexOf(target) >= 0) {
        return true;
      }
    } catch (err) {
      //
    }

    await this._rmBinLink(symlink);

    return false;
  }

  async _generateBinLink(relTarget, symlink) {
    await this._saveCmd(symlink, CYGWIN_LINK, relTarget);
    await this._saveCmd(symlink + ".cmd", CMD_BATCH, relTarget);
  }

  async _rmBinLink(symlink) {
    await this._unlinkFile(symlink);
    await this._unlinkFile(symlink + ".cmd");
  }

  async _readBinLinks() {
    return (await Fs.readdir(this._binDir)).filter(x => !x.endsWith(".cmd"));
  }

  async _saveCmd(name, data, target) {
    return Fs.writeFile(name, data.replace(/{{TARGET}}/g, target));
  }
}

module.exports = PkgBinLinkerWin32;
