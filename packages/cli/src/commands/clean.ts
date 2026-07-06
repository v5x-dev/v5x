import type { Sade } from "sade";
import chalk from "chalk";
import { cleanProject, inspectProject } from "../utils/project";
import { printJson } from "../utils/output";
import {
  projectOutputFiles,
  toWorkflowProjectJson,
} from "../utils/workflow-json";

export default function registerCleanCommand(program: Sade) {
  program
    .command("clean [path]", "clean build outputs", { alias: "cl" })
    .option("--json", "print machine-readable JSON")
    .action(
      async (path: string = process.cwd(), options: { json?: boolean }) => {
        const project = await inspectProject(path);
        if (options.json !== true)
          console.log(chalk.yellow(`cleaning ${project.type} program...`));
        await cleanProject(project, {
          stdout: options.json === true ? "ignore" : "inherit",
        });
        if (options.json === true) {
          printJson({
            command: "clean",
            project: toWorkflowProjectJson(project),
            outputFiles: projectOutputFiles(project),
          });
        }
      },
    );
}
