import type { Sade } from "sade";
import { basename, resolve } from "node:path";
import { createProject, parseToolchain } from "../utils/scaffold";

export default function registerInitCommand(program: Sade) {
  program
    .command("init [path]", "create a new V5 program in an empty directory")
    .option("-t, --type", "project toolchain")
    .action(async (inputPath: string = process.cwd(), options) => {
      const toolchain = parseToolchain(options.type);
      const path = resolve(inputPath);
      await createProject(path, toolchain, basename(path));
      console.log(`created ${toolchain} project at ${path}`);
    });
}
