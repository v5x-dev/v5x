import type { Sade } from "sade";
import chalk from "chalk";
import { cleanProject, inspectProject } from "../utils/project";

export default function registerCleanCommand(program: Sade) {
  program
    .command("clean [path]", "clean build outputs", { alias: "cl" })
    .action(async (path: string) => {
      path ??= process.cwd();
      const project = await inspectProject(path);
      console.log(chalk.yellow(`cleaning ${project.type} program...`));
      await cleanProject(project);
    });
}
