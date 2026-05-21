import { join } from "path";

export type ProgramType =
  | "pros"
  | "vexide"
  | "vexcode-cpp"
  | "vexcode-py"
  | "unknown";

export async function detectProgramType(path: string): Promise<ProgramType> {
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
