import { createCommand } from "commander";

const initCommand = createCommand("init").description(
  "create a new program in the given directory",
);

export default initCommand;
