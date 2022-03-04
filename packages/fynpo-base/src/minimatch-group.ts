import mm from "minimatch";
import _ from "lodash";

/**
 * Remember the minimatch group info from a pattern
 */
type MMGroup = {
  /** the minimatch object */
  mm: mm.IMinimatch;
  /** the minimatch sets */
  set: any[][];
  /** index of the set within the minimatch object */
  setIx: number;
  /** index of the first set that's not a literal string */
  ix: number;
  /** remaining sets from the first non-literal set */
  remain: number;
};

export type MMGroups = Record<string, MMGroup[]>;

/**
 * process a list of minimatch objects and group them by the string prefix of their patterns
 *
 * @param mms - array of minimatch
 * @param groups - object to group the minimatch objects
 * @returns object of grouped minimatch objects
 */
export function groupMM(mms: mm.IMinimatch[], groups: MMGroups) {
  mms.forEach((mm) => {
    mm.set.forEach((set, setIx) => {
      const ix = set.findIndex((s) => typeof s !== "string");
      const prefix = set.slice(0, ix).join("/");
      const save = {
        mm,
        set,
        setIx,
        ix,
        remain: set.length - ix,
      };

      /* istanbul ignore if */
      if (groups[prefix]) {
        groups[prefix].push(save);
      } else {
        groups[prefix] = [save];
      }
    });
  });

  return groups;
}

/**
 * process a minimatch pattern to group them for matching directories
 *
 * - needs to create a new pattern at every non-string part
 * @param pattern
 */
export function deconstructMM(m0: mm.IMinimatch) {
  const mms: mm.IMinimatch[] = [];
  const patterns = { m0, mms };
  const set = m0.set[0];
  const globParts = (m0 as any).globParts[0];
  const iParts = [];
  const { GLOBSTAR } = mm as any;

  for (let ix = 0; ix < set.length; ix++) {
    const s = set[ix];
    const g = globParts[ix];
    // if we hit something that's not string, then we need a mm with just the strings
    // because a dir like "src" will not match "src/*"
    if (typeof s !== "string" && iParts.length > 0) {
      mms.push(new mm.Minimatch(iParts.join("/"), m0.options));
    }

    if (ix === set.length - 1) {
      mms.push(m0);
      break;
    } else {
      iParts.push(g);

      if (typeof s !== "string") {
        mms.push(new mm.Minimatch(iParts.join("/"), m0.options));
      }
    }

    if (s === GLOBSTAR) {
      // a pattern ending in GLOBSTAR will match anything
      break;
    }
  }

  return patterns;
}

/**
 * check that a path matches against a list of minimatch patterns
 *
 * @param fullPath
 * @param patterns
 * @returns the first pattern that match or false
 */
export function checkMmMatch(fullPath: string, patterns: mm.IMinimatch[]) {
  return !_.isEmpty(patterns) && patterns.find((patternMm) => patternMm.match(fullPath));
}

/**
 * Take a full path and match each level of it to a list of minimatch patterns
 *
 * @param path
 * @param mms
 * @returns
 */
export function unrollMmMatch(path: string, mms: mm.IMinimatch[]): boolean {
  const parts = path.split("/");
  let rp: string;

  for (let i = 0; i < parts.length - 1; i++) {
    rp = rp !== undefined ? rp + "/" + parts[i] : parts[i];
    if (checkMmMatch(`${rp}/`, mms)) {
      return true;
    }
  }

  return !!checkMmMatch(path, mms);
}
