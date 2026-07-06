import { basename, dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  ProgramIniConfig,
  USER_FLASH_MAX_FILE_SIZE,
  type ZerobaseSlotNumber,
} from "@v5x/serial";
import { detectProgramType, type ProgramType } from "./detect";
import { isRecord } from "./guards";
import { runProcess } from "./process";

export interface ProjectInfo {
  path: string;
  type: ProgramType;
  name: string;
  description: string;
  artifact?: string;
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
  return {
    name: stringAt(metadata, ["py/state", "project_name"]),
    description: stringAt(metadata, [
      "py/state",
      "upload_options",
      "description",
    ]),
    output: stringAt(metadata, [
      "py/state",
      "templates",
      "kernel",
      "metadata",
      "output",
    ]),
  };
}

async function readVexideInfo(path: string) {
  const manifest = Bun.TOML.parse(
    await Bun.file(join(path, "Cargo.toml")).text(),
  );
  return {
    name: stringAt(manifest, ["package", "name"]),
    description: stringAt(manifest, ["package", "description"]),
  };
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
      return runProcess(["make"], project.path);
    case "vexide":
      return runProcess(["cargo", "v5", "build", "--release"], project.path);
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
      return runProcess(["make", "clean"], project.path);
    case "vexide":
      return runProcess(["cargo", "clean"], project.path);
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

  let newest: { path: string; modified: number } | undefined;
  const glob = new Bun.Glob(`**/${name}.bin`);
  for await (const relativePath of glob.scan({ cwd: root, onlyFiles: true })) {
    const path = resolve(root, relativePath);
    const { mtimeMs } = await stat(path);
    if (newest === undefined || mtimeMs > newest.modified) {
      newest = { path, modified: mtimeMs };
    }
  }
  return newest?.path;
}

export async function findProgramArtifact(
  project: ProjectInfo,
  explicitPath?: string,
): Promise<string> {
  if (explicitPath !== undefined) {
    const explicit = await existingFile(resolve(explicitPath));
    if (explicit === undefined) {
      throw new Error(
        `program artifact does not exist: ${resolve(explicitPath)}`,
      );
    }
    return explicit;
  }

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

  const artifact =
    project.type === "vexide"
      ? await newestNamedBinary(join(project.path, "target"), project.name)
      : undefined;
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

export const PROGRAM_ARTIFACT_SIZE_LIMIT = USER_FLASH_MAX_FILE_SIZE;

export interface ValidatedProgramArtifact {
  path: string;
  size: number;
}

export interface ValidatedProgramArtifacts {
  hot: ValidatedProgramArtifact;
  cold?: ValidatedProgramArtifact;
}

async function validateProgramArtifact(
  path: string,
  role: "hot" | "cold",
): Promise<ValidatedProgramArtifact> {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile()) {
    throw new Error(`program ${role} artifact does not exist: ${path}`);
  }
  if (info.size === 0) {
    throw new Error(`program ${role} artifact is empty: ${path}`);
  }
  if (info.size > PROGRAM_ARTIFACT_SIZE_LIMIT) {
    throw new Error(
      `program ${role} artifact ${path} is ${info.size} bytes; supported limit is ${PROGRAM_ARTIFACT_SIZE_LIMIT} bytes`,
    );
  }
  return { path, size: info.size };
}

export async function validateProgramArtifacts(
  artifacts: ProgramArtifacts,
): Promise<ValidatedProgramArtifacts> {
  return {
    hot: await validateProgramArtifact(artifacts.hot, "hot"),
    cold:
      artifacts.cold === undefined
        ? undefined
        : await validateProgramArtifact(artifacts.cold, "cold"),
  };
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
