import { Command } from "commander";
import { exists } from "fs/promises";
import { join } from "path";

export async function detectProgramType(path: string) {
  const prosFile = Bun.file(join(path, "project.pros"));
  if (await prosFile.exists()) {
    return "pros";
  }

  const cargoFile = Bun.file(join(path, "Cargo.toml"));
  if (await cargoFile.exists()) {
    const cargoData = Bun.TOML.parse(await cargoFile.text()) as any;
    if (Object.keys(cargoData.dependencies).includes("vexide")) {
      return "vexide";
    }
  }

  const vexMkEnvFile = Bun.file(join(path, "vex/mkenv.mk"));
  const vexMkRulesFile = Bun.file(join(path, "vex/mkrules.mk"));
  if ((await vexMkEnvFile.exists()) && (await vexMkRulesFile.exists())) {
    return "vexcode-cpp";
  }

  const pyFile = Bun.file(join(path, "src/main.py"));
  if (await pyFile.exists()) {
    return "vexcode-py";
  }

  return "unknown";
}

export const build = new Command("build")
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
        break;

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
