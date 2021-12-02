import VisualLogger from "visual-logger";
import { isCI } from "./is-ci";

export const logger = new VisualLogger();

if (isCI) {
  logger.info("CI env detected");
  logger.setItemType("none");
}
