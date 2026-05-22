import { createCommand } from "commander";

const uploadCommand = createCommand("upload")
  .description("upload a program or file to the v5 brain")
  .alias("u");

export default uploadCommand;
