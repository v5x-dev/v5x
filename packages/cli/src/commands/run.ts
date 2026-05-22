import { createCommand } from "commander";

const runCommand = createCommand("run")
  .description("build, upload, and run a program on a v5 brain")
  .alias("r");

export default runCommand;
