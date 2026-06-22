import { createCommand } from "commander";
import { uploadProgram } from "../utils/upload";

const uploadCommand = createCommand("upload")
  .description("build and upload a program to the V5 brain")
  .alias("u")
  .argument("[path]", "path to the program", process.cwd())
  .option("-s, --slot <slot>", "program slot", "1")
  .option("-n, --name <name>", "program name shown on the brain")
  .option("-d, --description <description>", "program description")
  .option("-i, --icon <icon>", "program icon file", "default.bmp")
  .option("-f, --file <path>", "upload an existing .bin artifact")
  .option("--no-build", "skip building the project")
  .option("--run", "start the program after uploading")
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
        run?: boolean;
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
        run: options.run ?? false,
      });
    },
  );

export default uploadCommand;
