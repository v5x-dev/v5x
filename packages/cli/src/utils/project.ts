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
import { mapWithConcurrency } from "./concurrency";

export const ARTIFACT_DISCOVERY_CONCURRENCY = 8;

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readProsInfo(path: string) {
  const filePath = join(path, "project.pros");
  let metadata: unknown;
  try {
    metadata = JSON.parse(await Bun.file(filePath).text());
  } catch (error) {
    throw new Error(
      `invalid project.pros at ${filePath}: ${errorMessage(error)}`,
    );
  }
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
  const filePath = join(path, "Cargo.toml");
  let manifest: unknown;
  try {
    manifest = Bun.TOML.parse(await Bun.file(filePath).text());
  } catch (error) {
    throw new Error(
      `invalid Cargo.toml at ${filePath}: ${errorMessage(error)}`,
    );
  }
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

interface ProjectProcessOptions {
  stdout?: "inherit" | "ignore";
}

export async function buildProject(
  project: ProjectInfo,
  options: ProjectProcessOptions = {},
): Promise<void> {
  switch (project.type) {
    case "pros":
    case "vexcode-cpp":
      return runProcess(["make"], project.path, options);
    case "vexide":
      return runProcess(
        ["cargo", "v5", "build", "--release"],
        project.path,
        options,
      );
    case "vexcode-py":
      throw new Error("building VEXcode Python projects is not supported");
    case "unknown":
      throw new Error("cannot build an unknown project type");
  }
}

export async function cleanProject(
  project: ProjectInfo,
  options: ProjectProcessOptions = {},
): Promise<void> {
  switch (project.type) {
    case "pros":
    case "vexcode-cpp":
      return runProcess(["make", "clean"], project.path, options);
    case "vexide":
      return runProcess(["cargo", "clean"], project.path, options);
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

export interface ArtifactFileInfo {
  isDirectory(): boolean;
  isFile(): boolean;
  mtimeMs: number;
}

export interface BinaryDiscoveryOperations {
  stat(path: string): Promise<ArtifactFileInfo>;
  scan(root: string, name: string): AsyncIterable<string>;
}

const binaryDiscoveryOperations: BinaryDiscoveryOperations = {
  stat,
  scan(root, name) {
    return new Bun.Glob(`**/${name}.bin`).scan({ cwd: root, onlyFiles: true });
  },
};

function newestCandidate(
  candidates: Array<{ path: string; modified: number } | undefined>,
): string | undefined {
  return candidates
    .filter((candidate) => candidate !== undefined)
    .sort(
      (left, right) =>
        right.modified - left.modified ||
        (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    )[0]?.path;
}

export async function newestNamedBinary(
  root: string,
  name: string,
  operations: BinaryDiscoveryOperations = binaryDiscoveryOperations,
): Promise<string | undefined> {
  if (!(await operations.stat(root).catch(() => undefined))?.isDirectory())
    return undefined;

  const conventionalPaths = [
    resolve(root, "armv7a-vex-v5", "release", `${name}.bin`),
    resolve(root, "release", `${name}.bin`),
  ];
  const conventional = await mapWithConcurrency(
    conventionalPaths,
    ARTIFACT_DISCOVERY_CONCURRENCY,
    async (path) => {
      const info = await operations.stat(path).catch(() => undefined);
      return info?.isFile() ? { path, modified: info.mtimeMs } : undefined;
    },
  );

  const paths: string[] = [];
  const conventionalPathSet = new Set(conventionalPaths);
  for await (const relativePath of operations.scan(root, name)) {
    const path = resolve(root, relativePath);
    if (!conventionalPathSet.has(path)) paths.push(path);
  }
  const candidates = await mapWithConcurrency(
    paths,
    ARTIFACT_DISCOVERY_CONCURRENCY,
    async (path) => {
      const info = await operations.stat(path).catch(() => undefined);
      return info?.isFile() ? { path, modified: info.mtimeMs } : undefined;
    },
  );
  return newestCandidate([...conventional, ...candidates]);
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
  const [hot, cold] = await Promise.allSettled([
    validateProgramArtifact(artifacts.hot, "hot"),
    artifacts.cold === undefined
      ? Promise.resolve(undefined)
      : validateProgramArtifact(artifacts.cold, "cold"),
  ]);
  if (hot.status === "rejected") throw hot.reason;
  if (cold.status === "rejected") throw cold.reason;
  return {
    hot: hot.value,
    cold: cold.value,
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
