import logger from "../logger";
import { execSync } from "../child-process";

export const getCurrentBranch = (opts) => {
  const branch = execSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts);
  logger.info("currentBranch", branch);

  return branch;
};
