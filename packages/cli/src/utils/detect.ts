import { join } from "path";

export type ProgramType =
  | "pros"
  | "vexide"
  | "vexcode-cpp"
  | "vexcode-py"
  | "unknown";

function hasVexideDependency(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (!("dependencies" in value)) return false;
  const dependencies = value.dependencies;
  return (
    typeof dependencies === "object" &&
    dependencies !== null &&
    "vexide" in dependencies
  );
}

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
    const config: unknown = Bun.TOML.parse(await cargoFile.text());
    if (hasVexideDependency(config)) return "vexide";
  }

  if (
    (await Promise.all(vexMkFiles.map((file) => file.exists()))).some(Boolean)
  ) {
    return "vexcode-cpp";
  }

  if (await vexPyFile.exists()) {
    return "vexcode-py";
  }

  return "unknown";
}
