import type { Sade } from "sade";
import { basename, join, resolve } from "node:path";
import { createProject, parseToolchain } from "../utils/scaffold";
import { printJson } from "../utils/output";
import { toWorkflowCreateJson } from "../utils/workflow-json";

export function assertProjectNameArgument(name: string): void {
  if (/[\\/]/.test(name)) {
    throw new Error(
      "project name cannot contain path separators; use --path for nested destinations",
    );
  }
}

export default function registerNewCommand(program: Sade) {
  program
    .command("new <name>", "create a new V5 program", { alias: "n" })
    .option("-t, --type", "project toolchain")
    .option("-p, --path", "destination path")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        name: string,
        options: { type?: string; path?: string; json?: boolean },
      ) => {
        const toolchain = parseToolchain(options.type);
        assertProjectNameArgument(name);
        const destination =
          options.path === undefined
            ? join(process.cwd(), name)
            : resolve(options.path);
        const path = await createProject(destination, toolchain, {
          displayName: name,
          cargoPackageName:
            toolchain === "vexide" ? name : basename(destination),
          prosRemoteName: name,
        });
        if (options.json === true) {
          printJson(toWorkflowCreateJson("new", path, toolchain));
        } else {
          console.log(`created ${toolchain} project at ${path}`);
        }
      },
    );
}
