import type { Sade } from "sade";
import {
  uploadProgramFromCommand,
  type UploadCommandOptions,
} from "../utils/upload";

export default function registerUploadCommand(program: Sade) {
  program
    .command("upload [path]", "build and upload a program to the V5 brain", {
      alias: "u",
    })
    .option("-s, --slot", "program slot", "1")
    .option("-n, --name", "program name shown on the brain")
    .option("-d, --description", "program description")
    .option("-i, --icon", "program icon file", "default.bmp")
    .option("-f, --file", "upload an existing .bin artifact")
    .option("--no-build", "skip building the project")
    .option("--run", "start the program after uploading")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action((path: string | undefined, options: UploadCommandOptions) =>
      uploadProgramFromCommand(path, options, false),
    );
}
