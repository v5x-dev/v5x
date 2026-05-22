import { createCommand } from "commander";
import { detectProgramType } from "../utils/detect";
import chalk from "chalk";

const buildCommand = createCommand("build")
  .description("build a program for the v5 brain")
  .alias("b")
  .argument("[path]", "path to the program", process.cwd())
  .action(async (path) => {
    const type = await detectProgramType(path);

    switch (type) {
      case "pros":
      case "vexcode-cpp":
        if (type === "pros")
          console.log(chalk.yellow("building PROS program..."));
        else if (type === "vexcode-cpp")
          console.log(chalk.redBright("building VEXCode program..."));

        const makeProc = Bun.spawn({
          cmd: ["make"],
          cwd: path,
          stdout: "inherit",
          stderr: "inherit",
        });

        await makeProc.exited;
        process.exit(makeProc.exitCode);
      case "vexide":
        console.log(chalk.yellowBright("building vexide program..."));

        const cargoProc = Bun.spawn({
          cmd: ["cargo", "v5", "build"],
          cwd: path,
          stdout: "inherit",
          stderr: "inherit",
        });

        await cargoProc.exited;
        process.exit(cargoProc.exitCode);
      case "unknown":
        console.error("program type could not be detected");
        process.exit(1);
    }
  });

export default buildCommand;
