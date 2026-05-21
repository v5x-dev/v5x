import { join } from "path";

export async function detectProgramType(path: string) {
  const prosFile = Bun.file(join(path, "project.pros"));
  if (await prosFile.exists()) {
    return "pros";
  }

  const cargoFile = Bun.file(join(path, "Cargo.toml"));
  if (await cargoFile.exists()) {
    const data = Bun.TOML.parse(await cargoFile.text()) as any;
    if ("dependencies" in data && "vexide" in data.dependencies) {
      return "vexide";
    }
  }

  const vexMkEnvFile = Bun.file(join(path, "vex", "mkenv.mk"));
  const vexMkRulesFile = Bun.file(join(path, "vex", "mkrules.mk"));
  if ((await vexMkEnvFile.exists()) && (await vexMkRulesFile.exists())) {
    return "vexcode-cpp";
  }

  const mainPyFile = Bun.file(join(path, "src", "main.py"));
  if (await mainPyFile.exists()) {
    return "vexcode-py";
  }

  return "unknown";
}
