import { createCommand, Option } from "commander";
import { join } from "node:path";
import { createProject, type ProjectToolchain } from "../utils/scaffold";

const newCommand = createCommand("new")
  .description("create a new V5 program")
  .alias("n")
  .argument("<name>", "project name")
  .addOption(
    new Option("-t, --type <type>", "project toolchain")
      .choices(["pros", "vexide"])
      .makeOptionMandatory(),
  )
  .action(async (name: string, options: { type: ProjectToolchain }) => {
    const path = await createProject(
      join(process.cwd(), name),
      options.type,
      name,
    );
    console.log(`created ${options.type} project at ${path}`);
  });

export default newCommand;
