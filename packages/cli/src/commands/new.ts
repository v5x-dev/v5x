import type { Sade } from "sade";
import { join } from "node:path";
import { createProject, type ProjectToolchain } from "../utils/scaffold";

export default function registerNewCommand(program: Sade) {
  program
    .command("new <name>", "create a new V5 program", { alias: "n" })
    .option("-t, --type", "project toolchain")
    .action(async (name: string, options: { type: ProjectToolchain }) => {
      if (options.type !== "pros" && options.type !== "vexide") {
        throw new Error("--type must be either pros or vexide");
      }
      const path = await createProject(
        join(process.cwd(), name),
        options.type,
        name,
      );
      console.log(`created ${options.type} project at ${path}`);
    });
}
