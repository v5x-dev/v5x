import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { hasErrorCode, isRecord } from "./guards";

export type ProjectToolchain = "pros" | "vexide";

export interface ProsTemplateSource {
  tag: string;
  archiveUrl: string;
  sha256: string;
}

interface DestinationReservation {
  created: boolean;
  device: bigint;
  inode: bigint;
}

interface ProjectNames {
  displayName: string;
  cargoPackageName: string;
  prosRemoteName: string;
}

export interface CreateProjectOptions {
  displayName?: string;
  cargoPackageName?: string;
  prosRemoteName?: string;
}

const FETCH_TIMEOUT_MS = 30_000;
const PROS_ARCHIVE_LIMIT = 64 * 1024 * 1024;
const PROS_EXTRACTED_LIMIT = 256 * 1024 * 1024;
const DEFAULT_PROS_TEMPLATE: ProsTemplateSource = {
  tag: "4.2.2",
  archiveUrl:
    "https://github.com/purduesigbots/pros/releases/download/4.2.2/kernel%404.2.2.zip",
  sha256: "f019642af93dc3d164d1c3e67a2a7dc75c795ac6a4d550c9221c480e2e7f4899",
};

export function parseToolchain(type: unknown): ProjectToolchain {
  if (type === "pros" || type === "vexide") return type;
  if (type === undefined) {
    throw new Error(
      "--type is required; use --type pros or --type vexide (for example: v5x new robot --type vexide)",
    );
  }
  throw new Error(
    `unsupported --type ${String(type)}; expected pros or vexide`,
  );
}

function validateDisplayName(name: string): void {
  if (name.length === 0 || /[\u0000-\u001f]/.test(name)) {
    throw new Error(
      "project name cannot be empty or contain control characters",
    );
  }
}

function validateCargoPackageName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(
      "Cargo package name must start with a letter or number and contain only letters, numbers, hyphens, or underscores",
    );
  }
}

function validateProsRemoteName(name: string): void {
  validateDisplayName(name);
  if (/[\\/]/.test(name)) {
    throw new Error("PROS remote name cannot contain path separators");
  }
}

function createProjectNames(
  toolchain: ProjectToolchain,
  fallbackName: string,
  options: CreateProjectOptions = {},
): ProjectNames {
  const displayName = options.displayName ?? fallbackName;
  const cargoPackageName = options.cargoPackageName ?? displayName;
  const prosRemoteName = options.prosRemoteName ?? displayName;

  validateDisplayName(displayName);
  if (toolchain === "vexide") validateCargoPackageName(cargoPackageName);
  else validateProsRemoteName(prosRemoteName);

  return { displayName, cargoPackageName, prosRemoteName };
}

async function reserveDestination(
  path: string,
): Promise<DestinationReservation> {
  let created = false;
  try {
    await mkdir(path);
    created = true;
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }

  const destination = await stat(path, { bigint: true }).catch(() => undefined);
  if (
    destination === undefined ||
    !destination.isDirectory() ||
    (await readdir(path)).length !== 0
  ) {
    throw new Error(`project directory is not empty: ${path}`);
  }
  return { created, device: destination.dev, inode: destination.ino };
}

async function removeOwnedReservation(
  path: string,
  reservation: DestinationReservation,
): Promise<void> {
  if (!reservation.created) return;
  const destination = await stat(path, { bigint: true }).catch(() => undefined);
  if (
    destination?.isDirectory() &&
    destination.dev === reservation.device &&
    destination.ino === reservation.inode
  ) {
    await rmdir(path).catch(() => undefined);
  }
}

async function fetchBytes(
  url: string,
  description: string,
  limit: number,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`failed to ${description} (${response.status})`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error(`${description} exceeds the ${limit}-byte size limit`);
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error(`${description} exceeds the ${limit}-byte size limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function writeFiles(
  root: string,
  files: Record<string, string | Uint8Array>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    if (
      isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).includes("..")
    ) {
      throw new Error(`template contains an unsafe path: ${relativePath}`);
    }
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, content);
  }
}

async function createProsProject(
  path: string,
  names: ProjectNames,
  source: ProsTemplateSource,
): Promise<void> {
  const bytes = await fetchBytes(
    source.archiveUrl,
    `download PROS kernel ${source.tag}`,
    PROS_ARCHIVE_LIMIT,
  );
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (digest !== source.sha256) {
    throw new Error(`PROS kernel ${source.tag} failed SHA-256 verification`);
  }

  let extractedLength = 0;
  const archive = unzipSync(bytes, {
    filter(file) {
      extractedLength += file.originalSize;
      if (extractedLength > PROS_EXTRACTED_LIMIT) {
        throw new Error(
          `PROS kernel archive exceeds the ${PROS_EXTRACTED_LIMIT}-byte extracted size limit`,
        );
      }
      return true;
    },
  });
  const templateBytes = archive["template.pros"];
  if (templateBytes === undefined) {
    throw new Error("the PROS kernel archive does not contain template.pros");
  }
  const template: unknown = JSON.parse(new TextDecoder().decode(templateBytes));
  if (!isRecord(template)) throw new Error("invalid PROS project template");

  const files: Record<string, string | Uint8Array> = {};
  for (const [relativePath, content] of Object.entries(archive)) {
    if (relativePath !== "template.pros" && !relativePath.endsWith("/")) {
      files[relativePath] = content;
    }
  }
  files["project.pros"] = `${JSON.stringify(
    {
      "py/object": "pros.conductor.project.Project",
      "py/state": {
        project_name: names.displayName,
        target: "v5",
        templates: { kernel: template },
        upload_options: {
          compress_bin: true,
          description: "",
          remote_name: names.prosRemoteName,
          slot: 1,
        },
        use_early_access: false,
      },
    },
    null,
    2,
  )}\n`;
  await writeFiles(path, files);
}

async function createVexideProject(
  path: string,
  names: ProjectNames,
): Promise<void> {
  const cargoName = JSON.stringify(names.cargoPackageName);
  await writeFiles(path, {
    ".gitignore": "/target\n",
    ".cargo/config.toml": `[target.'cfg(target_os = "vexos")']
rustflags = ["-Clink-arg=-Tvexide.ld"]

[unstable]
build-std = ["std", "panic_abort"]
build-std-features = ["compiler-builtins-mem"]
`,
    "rust-toolchain.toml": `[toolchain]
channel = "nightly-2025-11-26"
components = ["rust-src"]
`,
    "Cargo.toml": `[package]
name = ${cargoName}
version = "0.1.0"
edition = "2024"

[profile.release]
opt-level = "z"
lto = "fat"

[package.metadata.v5]
upload-strategy = "differential"
slot = 1
icon = "cool-x"
compress = true

[dependencies]
vexide = { version = "0.8.0", features = ["full", "default-sdk"] }
`,
    "src/main.rs": `use vexide::prelude::*;

struct Robot {}

impl Compete for Robot {
    async fn autonomous(&mut self) {
        println!("Autonomous!");
    }

    async fn driver(&mut self) {
        println!("Driver!");
    }
}

#[vexide::main]
async fn main(_peripherals: Peripherals) {
    Robot {}.compete().await;
}
`,
    "README.md": `# ${names.displayName}\n\nA vexide project created with @v5x/cli.\n`,
  });
}

export async function createProject(
  inputPath: string,
  toolchain: ProjectToolchain,
  nameOrOptions: string | CreateProjectOptions = basename(resolve(inputPath)),
  prosTemplate = DEFAULT_PROS_TEMPLATE,
): Promise<string> {
  const path = resolve(inputPath);
  const nameOptions =
    typeof nameOrOptions === "string"
      ? { displayName: nameOrOptions }
      : nameOrOptions;
  const names = createProjectNames(toolchain, basename(path), nameOptions);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const stagingPath = await mkdtemp(join(parent, `.${basename(path)}.v5x-`));
  let reservation: DestinationReservation | undefined;

  try {
    reservation = await reserveDestination(path);
    if (toolchain === "pros")
      await createProsProject(stagingPath, names, prosTemplate);
    else await createVexideProject(stagingPath, names);

    try {
      await rename(stagingPath, path);
    } catch (error) {
      const destination = await stat(path).catch(() => undefined);
      if (destination?.isDirectory() && (await readdir(path)).length === 0) {
        // Windows cannot replace an existing empty directory with rename().
        // rmdir() is atomic and fails if another process populated the directory.
        await rmdir(path);
        try {
          await rename(stagingPath, path);
        } catch (publishError) {
          await mkdir(path).catch(() => undefined);
          throw publishError;
        }
      } else if (destination !== undefined) {
        throw new Error(`project directory is not empty: ${path}`, {
          cause: error,
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    if (reservation !== undefined) {
      await removeOwnedReservation(path, reservation);
    }
    throw error;
  }

  return path;
}
