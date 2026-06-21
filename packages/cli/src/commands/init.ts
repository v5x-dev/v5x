import type { Sade } from "sade";
import { basename, resolve } from "node:path";
import { createProject, type ProjectToolchain } from "../utils/scaffold";

export default function registerInitCommand(program: Sade) {
  program
    .command("init [path]", "create a new V5 program in an empty directory")
    .option("-t, --type", "project toolchain")
    .action(async (inputPath: string, options: { type: ProjectToolchain }) => {
      inputPath ??= process.cwd();
      if (options.type !== "pros" && options.type !== "vexide") {
        throw new Error("--type must be either pros or vexide");
      }
      const path = resolve(inputPath);
      await createProject(path, options.type, basename(path));
      console.log(`created ${options.type} project at ${path}`);
    });
}
