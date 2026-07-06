import type { Sade } from "sade";
import chalk from "chalk";
import { buildProject, inspectProject } from "../utils/project";

export default function registerBuildCommand(program: Sade) {
  program
    .command("build [path]", "build a program for the V5 brain", { alias: "b" })
    .action(async (path: string = process.cwd()) => {
      const project = await inspectProject(path);
      console.log(chalk.yellow(`building ${project.type} program...`));
      await buildProject(project);
    });
}
