#!/usr/bin/env bun

import sade from "sade";
import pkg from "../package.json" with { type: "json" };
import build from "./commands/build";
import cat from "./commands/cat";
import clean from "./commands/clean";
import devices from "./commands/devices";
import dir from "./commands/dir";
import doctor from "./commands/doctor";
import init from "./commands/init";
import install from "./commands/install";
import kv from "./commands/kv";
import newProject from "./commands/new";
import programs from "./commands/programs";
import rm from "./commands/rm";
import run from "./commands/run";
import screenshot from "./commands/screenshot";
import upload from "./commands/upload";
import {
  cliExitCode,
  formatCliError,
  formatCliJsonError,
  isJsonOutput,
  isVerbose,
} from "./errors";

const program = sade("v5x")
  .version(pkg.version)
  .describe(pkg.description)
  .option("--verbose", "print stack traces for errors");

const commands = [
  build,
  clean,
  upload,
  run,
  programs,
  newProject,
  init,
  dir,
  doctor,
  cat,
  rm,
  devices,
  screenshot,
  install,
  kv,
];
for (const register of commands) register(program);

try {
  await program.parse(process.argv);
} catch (error) {
  console.error(
    isJsonOutput()
      ? formatCliJsonError(error)
      : formatCliError(error, isVerbose()),
  );
  process.exitCode = cliExitCode(error);
}
