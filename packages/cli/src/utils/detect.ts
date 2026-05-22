import { readdir } from "fs/promises";
import { join } from "path";

export type ProgramType =
  | "pros"
  | "vexide"
  | "vexcode-cpp"
  | "vexcode-py"
  | "unknown";

export async function detectProgramType(path: string): Promise<ProgramType> {
  const prosFile = Bun.file(join(path, "project.pros"));
  const cargoFile = Bun.file(join(path, "Cargo.toml"));
  const vexPyFile = Bun.file(join(path, "src", "main.py"));
  const vexMkFiles = [
    Bun.file(join(path, "vex", "mkenv.mk")),
    Bun.file(join(path, "vex", "mkrules.mk")),
  ];

  if (await prosFile.exists()) {
    return "pros";
  }

  if (await cargoFile.exists()) {
    const config = Bun.TOML.parse(await cargoFile.text()) as {
      dependencies: Record<string, any>;
    };

    if (Object.keys(config.dependencies).includes("vexide")) return "vexide";
  }

  if (await Promise.any(vexMkFiles.map((f) => f.exists()))) {
    return "vexcode-cpp";
  }

  if (await vexPyFile.exists()) {
    return "vexcode-py";
  }

  return "unknown";
}
