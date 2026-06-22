import { createCommand } from "commander";
import chalk from "chalk";
import { cleanProject, inspectProject } from "../utils/project";

const cleanCommand = createCommand("clean")
  .description("clean build outputs")
  .alias("cl")
  .argument("[path]", "path to the program", process.cwd())
  .action(async (path: string) => {
    path ??= process.cwd();
    const project = await inspectProject(path);
    console.log(chalk.yellow(`cleaning ${project.type} program...`));
    await cleanProject(project);
  });

export default cleanCommand;
