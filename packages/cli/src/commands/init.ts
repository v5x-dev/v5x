import type { Sade } from "sade";
import { basename, resolve } from "node:path";
import { createProject, parseToolchain } from "../utils/scaffold";
import { printJson } from "../utils/output";
import { toWorkflowCreateJson } from "../utils/workflow-json";

export default function registerInitCommand(program: Sade) {
  program
    .command("init [path]", "create a new V5 program in an empty directory")
    .option("-t, --type", "project toolchain (required: pros or vexide)")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        inputPath: string = process.cwd(),
        options: { type?: string | boolean; json?: boolean },
      ) => {
        const toolchain = parseToolchain(options.type);
        const path = resolve(inputPath);
        await createProject(path, toolchain, basename(path));
        if (options.json === true) {
          printJson(toWorkflowCreateJson("init", path, toolchain));
        } else {
          console.log(`created ${toolchain} project at ${path}`);
        }
      },
    );
}
