import { join } from "node:path";
import { isRecord } from "./guards";

export type ProgramType =
  | "pros"
  | "vexide"
  | "vexcode-cpp"
  | "vexcode-py"
  | "unknown";

function hasVexideDependency(manifest: unknown): boolean {
  return (
    isRecord(manifest) &&
    isRecord(manifest.dependencies) &&
    "vexide" in manifest.dependencies
  );
}

export async function detectProgramType(path: string): Promise<ProgramType> {
  if (await Bun.file(join(path, "project.pros")).exists()) return "pros";

  const cargoFile = Bun.file(join(path, "Cargo.toml"));
  if (await cargoFile.exists()) {
    const manifest: unknown = Bun.TOML.parse(await cargoFile.text());
    if (hasVexideDependency(manifest)) return "vexide";
  }

  const makeFiles = await Promise.all(
    ["mkenv.mk", "mkrules.mk"].map((name) =>
      Bun.file(join(path, "vex", name)).exists(),
    ),
  );
  if (makeFiles.some(Boolean)) return "vexcode-cpp";

  if (await Bun.file(join(path, "src", "main.py")).exists())
    return "vexcode-py";

  return "unknown";
}
