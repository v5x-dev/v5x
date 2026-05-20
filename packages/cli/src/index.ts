#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { program } from "commander";
import { build } from "./commands/build";

program
  .name("v5x")
  .description("modern v5 development")
  .version(pkg.version)
  .addCommand(build);

program.parse();
