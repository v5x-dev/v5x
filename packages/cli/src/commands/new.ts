import type { Sade } from "sade";
import { basename, join, resolve } from "node:path";
import { createProject, type ProjectToolchain } from "../utils/scaffold";

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
    .action(
      async (
        name: string,
        options: { type: ProjectToolchain; path?: string },
      ) => {
        if (options.type !== "pros" && options.type !== "vexide") {
          throw new Error("--type must be either pros or vexide");
        }
        assertProjectNameArgument(name);
        const destination =
          options.path === undefined
            ? join(process.cwd(), name)
            : resolve(options.path);
        const path = await createProject(destination, options.type, {
          displayName: name,
          cargoPackageName:
            options.type === "vexide" ? name : basename(destination),
          prosRemoteName: name,
        });
        console.log(`created ${options.type} project at ${path}`);
      },
    );
}
