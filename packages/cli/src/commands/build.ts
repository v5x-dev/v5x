import type { Sade } from "sade";
import chalk from "chalk";
import { buildProject, inspectProject } from "../utils/project";
import { printJson } from "../utils/output";
import {
  projectOutputFiles,
  toWorkflowProjectJson,
} from "../utils/workflow-json";

export default function registerBuildCommand(program: Sade) {
  program
    .command("build [path]", "build a program for the V5 brain", { alias: "b" })
    .option("--json", "print machine-readable JSON")
    .action(
      async (path: string = process.cwd(), options: { json?: boolean }) => {
        const project = await inspectProject(path);
        if (options.json !== true)
          console.log(chalk.yellow(`building ${project.type} program...`));
        await buildProject(project, {
          stdout: options.json === true ? "ignore" : "inherit",
        });
        if (options.json === true) {
          printJson({
            command: "build",
            project: toWorkflowProjectJson(project),
            outputFiles: projectOutputFiles(project),
          });
        }
      },
    );
}
