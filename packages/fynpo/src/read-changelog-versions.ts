/* eslint-disable prefer-template, no-magic-numbers */

import Fs from "fs";
import Path from "path";

export function readChangelogVersions(dir, packages, markers) {
  const tags = [];
  const versions = {};

  const check = (l) => {
    for (const name in packages) {
      const regex = new RegExp("[ `]" + name + "@([0-9]+.[0-9]+.[0-9]+)([^ `]*)[ `]");
      const m = l.match(regex);
      if (m) {
        tags.push(m[0].trim().replace(/`/g, ""));
        versions[name] = m.slice(1, 3).join("").trim().replace(/`/g, "");
      }
    }
  };

  const clLines = Fs.readFileSync(Path.join(dir, "CHANGELOG.md")).toString().split("\n");

  const ix1 = clLines.indexOf(markers[0]);
  const ix2 = clLines.indexOf(markers[1]);

  if (ix1 >= 0 && ix2 > ix1) {
    const lines = clLines.slice(ix1, ix2);
    lines.forEach(check);
  }

  return { tags, versions };
}
