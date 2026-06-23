import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { createProject } from "./scaffold";

const temporaryDirectories: string[] = [];
const prosArchive = zipSync({
  "template.pros": new TextEncoder().encode('{"version":"4.2.1"}'),
  "firmware.bin": new Uint8Array([1, 2, 3]),
});
const prosTemplate = {
  tag: "4.2.1-test",
  archiveUrl: "https://example.test/kernel.zip",
  sha256: new Bun.CryptoHasher("sha256").update(prosArchive).digest("hex"),
};

function archiveResponse(): Response {
  return new Response(prosArchive);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

test("writes a vexide project without invoking cargo-v5", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "test-robot");

  await createProject(path, "vexide", "test-robot");

  const cargoToml = await readFile(join(path, "Cargo.toml"), "utf8");
  expect(cargoToml).toContain('name = "test-robot"');
  expect(Bun.TOML.parse(cargoToml)).toMatchObject({
    package: { name: "test-robot" },
  });
  expect(await readFile(join(path, "src/main.rs"), "utf8")).toContain(
    "#[vexide::main]",
  );
});

test("separates display and toolchain names in generated projects", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);

  const vexidePath = join(parent, "vexide-project");
  await createProject(vexidePath, "vexide", {
    displayName: "Friendly Robot",
    cargoPackageName: "friendly_robot",
  });
  const cargoToml = await readFile(join(vexidePath, "Cargo.toml"), "utf8");
  expect(Bun.TOML.parse(cargoToml)).toMatchObject({
    package: { name: "friendly_robot" },
  });
  expect(
    (await readFile(join(vexidePath, "README.md"), "utf8")).startsWith(
      "# Friendly Robot",
    ),
  ).toBe(true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => archiveResponse(), {
    preconnect: originalFetch.preconnect,
  });
  try {
    const prosPath = join(parent, "pros-project");
    await createProject(
      prosPath,
      "pros",
      {
        displayName: "Friendly Robot",
        prosRemoteName: "friendly_remote",
      },
      prosTemplate,
    );
    const metadata: unknown = JSON.parse(
      await readFile(join(prosPath, "project.pros"), "utf8"),
    );
    expect(metadata).toMatchObject({
      "py/state": {
        project_name: "Friendly Robot",
        upload_options: { remote_name: "friendly_remote" },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid Cargo and PROS names", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);

  await expect(
    createProject(join(parent, "bad-cargo"), "vexide", {
      displayName: "Friendly Robot",
      cargoPackageName: "bad cargo",
    }),
  ).rejects.toThrow("Cargo package name");

  await expect(
    createProject(join(parent, "bad-pros"), "pros", {
      displayName: "Friendly Robot",
      prosRemoteName: "nested/robot",
    }),
  ).rejects.toThrow("PROS remote name");
});

test("replaces an existing empty directory", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "test-robot");
  await mkdir(path);

  await createProject(path, "vexide", "test-robot");

  expect(await readdir(path)).toContain("Cargo.toml");
});

test("refuses to overwrite a non-empty directory", async () => {
  const path = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(path);
  await Bun.write(join(path, "existing.txt"), "keep me");

  expect(createProject(path, "vexide", "robot")).rejects.toThrow(
    "project directory is not empty",
  );
});

test("removes only staged output when project creation fails", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "bad-project");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => new Response("failed", { status: 500 }),
    { preconnect: originalFetch.preconnect },
  );
  try {
    await expect(
      createProject(path, "pros", "robot", prosTemplate),
    ).rejects.toThrow();
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves an existing empty directory when creation fails", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "bad-project");
  await mkdir(path);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => new Response("failed", { status: 500 }),
    { preconnect: originalFetch.preconnect },
  );
  try {
    await expect(
      createProject(path, "pros", "robot", prosTemplate),
    ).rejects.toThrow();
    await expect(readdir(path)).resolves.toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not overwrite files created while a PROS project downloads", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "raced-project");
  let unblockArchive: (() => void) | undefined;
  const archiveBlocked = new Promise<void>((resolve) => {
    unblockArchive = resolve;
  });
  let requestCount = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => {
      requestCount += 1;
      await archiveBlocked;
      return archiveResponse();
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    const creation = createProject(path, "pros", "robot", prosTemplate);
    while (requestCount < 1) await Bun.sleep(1);
    await Bun.write(join(path, "concurrent.txt"), "keep me");
    unblockArchive?.();

    await expect(creation).rejects.toThrow("project directory is not empty");
    await expect(readFile(join(path, "concurrent.txt"), "utf8")).resolves.toBe(
      "keep me",
    );
    expect(
      (await readdir(parent)).some((entry) => entry.includes(".v5x-")),
    ).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an oversized PROS archive before reading it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "oversized-project");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () =>
      new Response(new Uint8Array(), {
        headers: { "content-length": String(65 * 1024 * 1024) },
      }),
    { preconnect: originalFetch.preconnect },
  );
  try {
    await expect(
      createProject(path, "pros", "robot", prosTemplate),
    ).rejects.toThrow("size limit");
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a PROS archive that fails integrity verification", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "invalid-project");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => archiveResponse(), {
    preconnect: originalFetch.preconnect,
  });

  try {
    await expect(
      createProject(path, "pros", "robot", {
        ...prosTemplate,
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("SHA-256");
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
