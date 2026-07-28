import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import { basename, join, resolve } from "node:path";
import { requireOptionValue } from "../utils/guards";
import { createProject, parseToolchain } from "../utils/scaffold";
import { printOutput } from "../utils/output";
import { toWorkflowCreateJson } from "../utils/workflow-json";

export function assertProjectNameArgument(name: string): void {
  if (/[\\/]/.test(name)) {
    throw new Error(
      "project name cannot contain path separators; use --path for nested destinations",
    );
  }
}

export default function registerNewCommand(program: Sade) {
  withCommonOptions(
    program
      .command("new <name>", "create a new V5 program", { alias: "n" })
      .option("-t, --type", "project toolchain (required: pros or vexide)")
      .option("-p, --path", "destination path"),
  ).action(
    async (
      name: string,
      options: {
        type?: string | boolean;
        path?: string | boolean;
        json?: boolean;
      },
    ) => {
      const toolchain = parseToolchain(options.type);
      const destinationPath = requireOptionValue(options.path, "--path");
      assertProjectNameArgument(name);
      const destination =
        destinationPath === undefined
          ? join(process.cwd(), name)
          : resolve(destinationPath);
      const path = await createProject(destination, toolchain, {
        displayName: name,
        cargoPackageName: toolchain === "vexide" ? name : basename(destination),
        prosRemoteName: name,
      });
      printOutput(
        options.json,
        toWorkflowCreateJson("new", path, toolchain),
        `created ${toolchain} project at ${path}`,
      );
    },
  );
}
