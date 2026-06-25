import type { Sade } from "sade";
import {
  uploadProgramFromCommand,
  type UploadCommandOptions,
} from "../utils/upload";

export default function registerRunCommand(program: Sade) {
  program
    .command("run [path]", "build, upload, and run a program on a V5 brain", {
      alias: "r",
    })
    .option("-s, --slot", "program slot", "1")
    .option("-n, --name", "program name shown on the brain")
    .option("-d, --description", "program description")
    .option("-i, --icon", "program icon file", "default.bmp")
    .option("-f, --file", "upload an existing .bin artifact")
    .option("--no-build", "skip building the project")
    .action((path: string | undefined, options: UploadCommandOptions) =>
      uploadProgramFromCommand(path, options, true),
    );
}
