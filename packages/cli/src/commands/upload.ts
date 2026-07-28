import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import {
  uploadProgramFromCommand,
  type UploadCommandOptions,
} from "../utils/upload";

export default function registerUploadCommand(program: Sade) {
  withCommonOptions(
    program.command(
      "upload [path]",
      "build and upload a program to the V5 brain",
      { alias: "u" },
    ),
    { port: true },
  )
    .option("-s, --slot", "program slot", "1")
    .option("-n, --name", "program name shown on the brain")
    .option("-d, --description", "program description")
    .option("-i, --icon", "program icon file", "default.bmp")
    .option("-f, --file", "upload an existing .bin artifact")
    .option("--no-build", "skip building the project")
    .option("--run", "start the program after uploading")
    .option("-t, --terminal", "stream the program's output; implies --run")
    .action((path: string | undefined, options: UploadCommandOptions) =>
      uploadProgramFromCommand(path, options, false),
    );
}
