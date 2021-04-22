export interface ParsedOpts {
  commitlint?: boolean;
}
export interface ParsedObj {
  [x: string]: any;
  opts: ParsedOpts;
}
