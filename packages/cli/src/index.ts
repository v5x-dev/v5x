#!/usr/bin/env bun

import sade from "sade";
import pkg from "../package.json" with { type: "json" };
import registerKvCommand from "./commands/kv";
import registerCatCommand from "./commands/cat";
import registerBuildCommand from "./commands/build";
import registerDevicesCommand from "./commands/devices";
import registerDirCommand from "./commands/dir";
import registerUploadCommand from "./commands/upload";
import registerRunCommand from "./commands/run";
import registerNewCommand from "./commands/new";
import registerInitCommand from "./commands/init";
import registerRmCommand from "./commands/rm";
import registerScreenshotCommand from "./commands/screenshot";
import registerInstallCommand from "./commands/install";
import registerCleanCommand from "./commands/clean";
import registerProgramsCommand from "./commands/programs";

const program = sade("v5x").version(pkg.version).describe(pkg.description);

registerBuildCommand(program);
registerCleanCommand(program);
registerUploadCommand(program);
registerRunCommand(program);
registerProgramsCommand(program);
registerNewCommand(program);
registerInitCommand(program);
registerDirCommand(program);
registerCatCommand(program);
registerRmCommand(program);
registerDevicesCommand(program);
registerScreenshotCommand(program);
registerInstallCommand(program);
registerKvCommand(program);

try {
  await program.parse(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
