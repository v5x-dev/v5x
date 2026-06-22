import { createCommand, Option } from "commander";
import { basename, resolve } from "node:path";
import { createProject, type ProjectToolchain } from "../utils/scaffold";

const initCommand = createCommand("init")
  .description("create a new V5 program in an empty directory")
  .argument("[path]", "project directory", process.cwd())
  .addOption(
    new Option("-t, --type <type>", "project toolchain")
      .choices(["pros", "vexide"])
      .makeOptionMandatory(),
  )
  .action(async (inputPath: string, options: { type: ProjectToolchain }) => {
    const path = resolve(inputPath);
    await createProject(path, options.type, basename(path));
    console.log(`created ${options.type} project at ${path}`);
  });

export default initCommand;
