import type { Sade } from "sade";
import { uploadProgram } from "../utils/upload";

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
    .action(
      async (
        path: string,
        options: {
          slot: string;
          name?: string;
          description?: string;
          icon: string;
          file?: string;
          build?: boolean;
        },
      ) => {
        path ??= process.cwd();
        await uploadProgram({
          path,
          slot: Number(options.slot),
          name: options.name,
          description: options.description,
          icon: options.icon,
          artifact: options.file,
          build: options.build ?? true,
          run: true,
        });
      },
    );
}
