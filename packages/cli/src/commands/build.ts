import { Command } from "commander";
import { exists } from "fs/promises";
import { detectProgramType } from "../utils/detect";

export const build = new Command("build")
  .alias("b")
  .description("build a program for the vex v5 brain")
  .argument("[path]", "path to the program", process.cwd())
  .option("-t, --type <type>", "type of the program")
  .action(async (path, options) => {
    if (!(await exists(path))) {
      console.error(`path does not exist: ${path}`);
      return;
    }

    const type = options.type ?? (await detectProgramType(path));

    switch (type) {
      case "vexcode-cpp":
      case "pros":
        const makeProc = Bun.spawn({
          cmd: ["make"],
          cwd: path,
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        });

        await makeProc.exited;
        process.exit(makeProc.exitCode);

      case "vexide":
        const cargoProc = Bun.spawn({
          cmd: ["cargo", "v5", "build"],
          cwd: path,
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        });

        await cargoProc.exited;
        process.exit(cargoProc.exitCode ?? 1);

      case "vexcode-py":
        break;

      case "unknown":
        console.error("could not detect program type");
        break;

      default:
        console.error(`unknown program type: ${type}`);
        break;
    }
  });
