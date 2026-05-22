import { createCommand } from "commander";
import { detectProgramType } from "../utils/detect";
import chalk from "chalk";

const cleanCommand = createCommand("clean")
  .description("clean build outputs")
  .alias("cl")
  .argument("[path]", "path to the program", process.cwd())
  .action(async (path) => {
    const type = await detectProgramType(path);

    switch (type) {
      case "pros":
      case "vexcode-cpp":
        if (type === "pros")
          console.log(chalk.yellowBright("cleaning PROS program..."));
        else if (type === "vexcode-cpp")
          console.log(chalk.redBright("cleaning VEXCode program..."));

        const makeProc = Bun.spawn({
          cmd: ["make", "clean"],
          cwd: path,
          stdout: "inherit",
          stderr: "inherit",
        });

        await makeProc.exited;
        process.exit(makeProc.exitCode);

      case "unknown":
        console.error(chalk.red("program type could not be detected"));
        process.exit(1);
    }
  });

export default cleanCommand;
