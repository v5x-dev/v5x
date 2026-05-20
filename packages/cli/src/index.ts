#!/usr/bin/env bun

import { Command } from "commander";
import packageJson from "../package.json";
import { kv } from "./commands/kv";

const program = new Command();

program
  .name("v5x")
  .description("modern v5 development")
  .version(packageJson.version);

program.addCommand(kv);

program.parse();
