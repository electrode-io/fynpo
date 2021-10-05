import Path from "path";

/**
 * ensure a path uses `/` for separator
 */
export const posixify = Path.sep === "/" ? (x) => x : (path) => path.replace(/\\/g, "/");
