import { createCommand } from "commander";

const installCommand = createCommand("install").description(
  "install v5 development dependencies",
);

export default installCommand;
