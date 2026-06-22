import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProject } from "./scaffold";

const temporaryDirectories: string[] = [];

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

  expect(await readFile(join(path, "Cargo.toml"), "utf8")).toContain(
    'name = "test-robot"',
  );
  expect(await readFile(join(path, "src/main.rs"), "utf8")).toContain(
    "#[vexide::main]",
  );
});

test("refuses to overwrite a non-empty directory", async () => {
  const path = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(path);
  await Bun.write(join(path, "existing.txt"), "keep me");

  expect(createProject(path, "vexide", "robot")).rejects.toThrow(
    "project directory is not empty",
  );
});

test("removes partial output when project creation fails", async () => {
  const parent = await mkdtemp(join(tmpdir(), "v5x-scaffold-"));
  temporaryDirectories.push(parent);
  const path = join(parent, "bad-project");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => new Response("failed", { status: 500 }),
    { preconnect: originalFetch.preconnect },
  );
  try {
    await expect(createProject(path, "pros", "robot")).rejects.toThrow();
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
