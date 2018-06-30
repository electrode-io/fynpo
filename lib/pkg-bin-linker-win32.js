"use strict";

/* eslint-disable global-require, prefer-template */

const Fs = require("./util/file-ops");
const PkgBinLinkerBase = require("./pkg-bin-linker-base");

//
// Look at each promoted package and link their bin
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

  _ensureGoodLink(symlink, target) {
    try {
      const existTarget = Fs.readFileSync(symlink).toString();
      if (existTarget.indexOf(target) >= 0) {
        return true;
      }
    } catch (err) {
      //
    }

    this._rmBinLink(symlink);

    return false;
  }

  _generateBinLink(relTarget, symlink) {
    this._saveCmd(symlink, CYGWIN_LINK, relTarget);
    this._saveCmd(symlink + ".cmd", CMD_BATCH, relTarget);
  }

  _rmBinLink(symlink) {
    this._unlinkFile(symlink);
    this._unlinkFile(symlink + ".cmd");
  }

  _readBinLinks() {
    return Fs.readdirSync(this._binDir).filter(x => !x.endsWith(".cmd"));
  }

  _saveCmd(name, data, target) {
    Fs.writeFileSync(name, data.replace(/{{TARGET}}/g, target));
  }
}

module.exports = PkgBinLinkerWin32;
