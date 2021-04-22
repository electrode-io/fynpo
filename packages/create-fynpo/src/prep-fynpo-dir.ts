/* eslint-disable no-console, no-process-exit */

import Fs from "opfs";
import Path from "path";
import prompts from "prompts";

export async function prepareFynpoDir(appDirName) {
  if (appDirName === ".") {
    const dirName = Path.basename(process.cwd());
    console.log(`Using current directory '${dirName}' to create app`);
    return dirName;
  }

  try {
    await Fs.mkdir(appDirName);
  } catch (err) {
    if (err.code !== "EEXIST") {
      console.log(`Failed to create app directory '${appDirName}'`);
      process.exit(1);
    }
  }

  process.chdir(appDirName);

  return appDirName;
}

export async function checkDir(dirName?: string): Promise<boolean> {
  const existDirFiles = await Fs.readdir(process.cwd());
  if (existDirFiles.length > 0) {
    const response = await prompts({
      type: "confirm",
      name: "overwrite",
      message: `Your directory '${dirName}' is not empty, write to it?`,
    });

    return response.overwrite;
  }

  return true;
}
