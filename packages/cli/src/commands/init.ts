import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import { basename, resolve } from "node:path";
import { createProject, parseToolchain } from "../utils/scaffold";
import { printOutput } from "../utils/output";
import { toWorkflowCreateJson } from "../utils/workflow-json";

export default function registerInitCommand(program: Sade) {
  withCommonOptions(
    program
      .command("init [path]", "create a new V5 program in an empty directory")
      .option("-t, --type", "project toolchain (required: pros or vexide)"),
  ).action(
    async (
      inputPath: string = process.cwd(),
      options: { type?: string | boolean; json?: boolean },
    ) => {
      const toolchain = parseToolchain(options.type);
      const path = resolve(inputPath);
      await createProject(path, toolchain, basename(path));
      printOutput(
        options.json,
        toWorkflowCreateJson("init", path, toolchain),
        `created ${toolchain} project at ${path}`,
      );
    },
  );
}
