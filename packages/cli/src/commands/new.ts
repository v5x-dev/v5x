import { createCommand } from "commander";

const newCommand = createCommand("new")
  .description("create a new program with a given name")
  .alias("n");

export default newCommand;
