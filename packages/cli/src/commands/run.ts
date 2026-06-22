import { createCommand } from "commander";
import { uploadProgram } from "../utils/upload";

const runCommand = createCommand("run")
  .description("build, upload, and run a program on a V5 brain")
  .alias("r")
  .argument("[path]", "path to the program", process.cwd())
  .option("-s, --slot <slot>", "program slot", "1")
  .option("-n, --name <name>", "program name shown on the brain")
  .option("-d, --description <description>", "program description")
  .option("-i, --icon <icon>", "program icon file", "default.bmp")
  .option("-f, --file <path>", "upload an existing .bin artifact")
  .option("--no-build", "skip building the project")
  .action(
    async (
      path: string,
      options: {
        slot: string;
        name?: string;
        description?: string;
        icon: string;
        file?: string;
        build: boolean;
      },
    ) => {
      await uploadProgram({
        path,
        slot: Number(options.slot),
        name: options.name,
        description: options.description,
        icon: options.icon,
        artifact: options.file,
        build: options.build,
        run: true,
      });
    },
  );

export default runCommand;
