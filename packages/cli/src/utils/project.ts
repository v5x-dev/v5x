import { basename, dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { ProgramIniConfig, type ZerobaseSlotNumber } from "@v5x/serial";
import { detectProgramType, type ProgramType } from "./detect";
import { runProcess } from "./process";

export interface ProjectInfo {
  path: string;
  type: ProgramType;
  name: string;
  description: string;
  artifact?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringAt(value: unknown, keys: string[]): string | undefined {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

async function readProsInfo(path: string) {
  const metadata: unknown = await Bun.file(join(path, "project.pros")).json();
  const name = stringAt(metadata, ["py/state", "project_name"]);
  const output = stringAt(metadata, [
    "py/state",
    "templates",
    "kernel",
    "metadata",
    "output",
  ]);
  const description = stringAt(metadata, [
    "py/state",
    "upload_options",
    "description",
  ]);
  return { name, description, output };
}

async function readVexideInfo(path: string) {
  const manifest = Bun.TOML.parse(
    await Bun.file(join(path, "Cargo.toml")).text(),
  );
  const name = stringAt(manifest, ["package", "name"]);
  const description = stringAt(manifest, ["package", "description"]);
  return { name, description };
}

export async function inspectProject(inputPath: string): Promise<ProjectInfo> {
  const path = resolve(inputPath);
  const type = await detectProgramType(path);
  const fallbackName = basename(path);

  switch (type) {
    case "pros": {
      const metadata = await readProsInfo(path);
      return {
        path,
        type,
        name: metadata.name ?? fallbackName,
        description: metadata.description ?? "",
        artifact: metadata.output ? resolve(path, metadata.output) : undefined,
      };
    }
    case "vexide": {
      const metadata = await readVexideInfo(path);
      return {
        path,
        type,
        name: metadata.name ?? fallbackName,
        description: metadata.description ?? "",
      };
    }
    case "vexcode-cpp":
    case "vexcode-py":
      return { path, type, name: fallbackName, description: "" };
    case "unknown":
      throw new Error(`no supported V5 project found at ${path}`);
  }
}

export async function buildProject(project: ProjectInfo): Promise<void> {
  switch (project.type) {
    case "pros":
    case "vexcode-cpp":
      await runProcess(["make"], project.path);
      return;
    case "vexide":
      await runProcess(["cargo", "v5", "build", "--release"], project.path);
      return;
    case "vexcode-py":
      throw new Error("building VEXcode Python projects is not supported");
    case "unknown":
      throw new Error("cannot build an unknown project type");
  }
}

export async function cleanProject(project: ProjectInfo): Promise<void> {
  switch (project.type) {
    case "pros":
    case "vexcode-cpp":
      await runProcess(["make", "clean"], project.path);
      return;
    case "vexide":
      await runProcess(["cargo", "clean"], project.path);
      return;
    case "vexcode-py":
      throw new Error("cleaning VEXcode Python projects is not supported");
    case "unknown":
      throw new Error("cannot clean an unknown project type");
  }
}

async function existingFile(
  path: string | undefined,
): Promise<string | undefined> {
  if (path === undefined) return undefined;
  return (await stat(path).catch(() => undefined))?.isFile() ? path : undefined;
}

async function newestNamedBinary(
  root: string,
  name: string,
): Promise<string | undefined> {
  if (!(await stat(root).catch(() => undefined))?.isDirectory())
    return undefined;
  const glob = new Bun.Glob(`**/${name}.bin`);
  const candidates: Array<{ path: string; modified: number }> = [];
  for await (const relativePath of glob.scan({ cwd: root, onlyFiles: true })) {
    const path = resolve(root, relativePath);
    const info = await stat(path);
    candidates.push({ path, modified: info.mtimeMs });
  }
  candidates.sort((left, right) => right.modified - left.modified);
  return candidates[0]?.path;
}

export async function findProgramArtifact(
  project: ProjectInfo,
  explicitPath?: string,
): Promise<string> {
  const explicit = await existingFile(
    explicitPath === undefined ? undefined : resolve(explicitPath),
  );
  if (explicitPath !== undefined && explicit === undefined) {
    throw new Error(
      `program artifact does not exist: ${resolve(explicitPath)}`,
    );
  }
  if (explicit !== undefined) return explicit;

  const configured = await existingFile(project.artifact);
  if (configured !== undefined) return configured;

  const conventionalPaths =
    project.type === "pros"
      ? ["bin/monolith.bin", "bin/hot.package.bin"]
      : project.type === "vexcode-cpp"
        ? [`build/${project.name}.bin`]
        : [];
  for (const relativePath of conventionalPaths) {
    const candidate = await existingFile(join(project.path, relativePath));
    if (candidate !== undefined) return candidate;
  }

  const outputRoot =
    project.type === "vexide" ? join(project.path, "target") : undefined;
  const artifact =
    outputRoot === undefined
      ? undefined
      : await newestNamedBinary(outputRoot, project.name);
  if (artifact === undefined) {
    throw new Error(
      `no program artifact found for ${project.name}; build the project or pass --file`,
    );
  }
  return artifact;
}

export interface ProgramArtifacts {
  hot: string;
  cold?: string;
}

export async function findProgramArtifacts(
  project: ProjectInfo,
  explicitPath?: string,
): Promise<ProgramArtifacts> {
  const hot = await findProgramArtifact(project, explicitPath);
  if (project.type !== "pros" || basename(hot) !== "hot.package.bin") {
    return { hot };
  }

  const cold = await existingFile(join(dirname(hot), "cold.package.bin"));
  if (cold === undefined) {
    throw new Error(`PROS hot package is missing its cold package: ${hot}`);
  }
  return { hot, cold };
}

export function createProgramConfig(options: {
  slot: number;
  name: string;
  description: string;
  icon: string;
  type: ProgramType;
  run: boolean;
}): ProgramIniConfig {
  if (!Number.isInteger(options.slot) || options.slot < 1 || options.slot > 8) {
    throw new Error("slot must be an integer from 1 through 8");
  }

  const config = new ProgramIniConfig();
  config.baseName = `slot_${options.slot}`;
  config.autorun = options.run;
  config.project.ide = options.type;
  config.program.name = options.name;
  config.program.description = options.description;
  config.program.icon = options.icon;
  config.program.slot = (options.slot - 1) as ZerobaseSlotNumber;
  return config;
}
