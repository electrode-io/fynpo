import mm from "minimatch";

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
