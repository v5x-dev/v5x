import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { unzipSync } from "fflate";

export type ProjectToolchain = "pros" | "vexide";

interface ProsRelease {
  tag: string;
  archiveUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateProjectName(name: string): void {
  if (name.length === 0 || /[\u0000-\u001f]/.test(name)) {
    throw new Error(
      "project name cannot be empty or contain control characters",
    );
  }
}

async function prepareDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  if (entries.length !== 0) {
    throw new Error(`project directory is not empty: ${path}`);
  }
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

async function latestProsRelease(): Promise<ProsRelease> {
  const response = await fetch(
    "https://api.github.com/repos/purduesigbots/pros/releases/latest",
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) {
    throw new Error(
      `failed to find the latest PROS kernel (${response.status})`,
    );
  }

  const release: unknown = await response.json();
  if (!isRecord(release) || typeof release.tag_name !== "string") {
    throw new Error("GitHub returned invalid PROS release metadata");
  }
  if (!Array.isArray(release.assets)) {
    throw new Error("the latest PROS release has no downloadable assets");
  }

  const expectedName = `kernel@${release.tag_name}.zip`;
  const asset = release.assets.find(
    (value) =>
      isRecord(value) &&
      value.name === expectedName &&
      typeof value.browser_download_url === "string",
  );
  if (!isRecord(asset) || typeof asset.browser_download_url !== "string") {
    throw new Error(`the latest PROS release is missing ${expectedName}`);
  }
  return { tag: release.tag_name, archiveUrl: asset.browser_download_url };
}

async function createProsProject(path: string, name: string): Promise<void> {
  const release = await latestProsRelease();
  const response = await fetch(release.archiveUrl);
  if (!response.ok) {
    throw new Error(`failed to download PROS kernel ${release.tag}`);
  }

  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
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
        project_name: name,
        target: "v5",
        templates: { kernel: template },
        upload_options: {
          compress_bin: true,
          description: "",
          remote_name: name,
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

async function createVexideProject(path: string, name: string): Promise<void> {
  const cargoName = JSON.stringify(name);
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
    "README.md": `# ${name}\n\nA vexide project created with @v5x/cli.\n`,
  });
}

export async function createProject(
  inputPath: string,
  toolchain: ProjectToolchain,
  name = basename(resolve(inputPath)),
): Promise<string> {
  validateProjectName(name);
  const path = resolve(inputPath);
  await prepareDirectory(path);

  if (toolchain === "pros") await createProsProject(path, name);
  else await createVexideProject(path, name);

  return path;
}
