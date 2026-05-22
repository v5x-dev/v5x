#!/usr/bin/env bun

import { program } from "commander";
import pkg from "../package.json" with { type: "json" };
import kvCommand from "./commands/kv";
import catCommand from "./commands/cat";
import buildCommand from "./commands/build";
import devicesCommand from "./commands/devices";
import dirCommand from "./commands/dir";
import uploadCommand from "./commands/upload";
import runCommand from "./commands/run";
import newCommand from "./commands/new";
import initCommand from "./commands/init";
import rmCommand from "./commands/rm";
import screenshotCommand from "./commands/screenshot";
import installCommand from "./commands/install";
import cleanCommand from "./commands/clean";

program
  .name("v5x")
  .version(pkg.version)
  .description(pkg.description)
  .addCommand(buildCommand)
  .addCommand(cleanCommand)
  .addCommand(uploadCommand)
  .addCommand(runCommand)
  .addCommand(newCommand)
  .addCommand(initCommand)
  .addCommand(dirCommand)
  .addCommand(catCommand)
  .addCommand(rmCommand)
  .addCommand(devicesCommand)
  .addCommand(screenshotCommand)
  .addCommand(installCommand)
  .addCommand(kvCommand);

program.parse();
