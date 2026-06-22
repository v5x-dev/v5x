import { createCommand } from "commander";
import chalk from "chalk";
import { buildProject, inspectProject } from "../utils/project";

const buildCommand = createCommand("build")
  .description("build a program for the V5 brain")
  .alias("b")
  .argument("[path]", "path to the program", process.cwd())
  .action(async (path: string) => {
    path ??= process.cwd();
    const project = await inspectProject(path);
    console.log(chalk.yellow(`building ${project.type} program...`));
    await buildProject(project);
  });

export default buildCommand;
