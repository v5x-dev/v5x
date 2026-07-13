import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { detectProgramType } from "./detect";
import {
  createProgramConfig,
  findProgramArtifact,
  findProgramArtifacts,
  inspectProject,
  newestNamedBinary,
  ARTIFACT_DISCOVERY_CONCURRENCY,
  PROGRAM_ARTIFACT_SIZE_LIMIT,
  validateProgramArtifacts,
} from "./project";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "v5x-cli-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("project detection", () => {
  test("detects a VEXcode project when either make environment file exists", async () => {
    const path = await temporaryDirectory();
    await mkdir(join(path, "vex"));
    await writeFile(join(path, "vex", "mkrules.mk"), "");
    expect(await detectProgramType(path)).toBe("vexcode-cpp");
  });

  test("ignores malformed Cargo manifests during detection", async () => {
    const path = await temporaryDirectory();
    await writeFile(join(path, "Cargo.toml"), "[package");
    await mkdir(join(path, "vex"));
    await writeFile(join(path, "vex", "mkrules.mk"), "");

    expect(await detectProgramType(path)).toBe("vexcode-cpp");
  });

  test("reads PROS metadata and its configured artifact", async () => {
    const path = await temporaryDirectory();
    await writeFile(
      join(path, "project.pros"),
      JSON.stringify({
        "py/state": {
          project_name: "test-robot",
          templates: { kernel: { metadata: { output: "bin/program.bin" } } },
          upload_options: { description: "test program" },
        },
      }),
    );
    await mkdir(join(path, "bin"));
    await writeFile(join(path, "bin", "program.bin"), "program");

    const project = await inspectProject(path);
    expect(project.name).toBe("test-robot");
    expect(project.description).toBe("test program");
    expect(await findProgramArtifact(project)).toBe(
      join(path, "bin", "program.bin"),
    );
  });

  test("reports malformed PROS metadata with its file path", async () => {
    const path = await temporaryDirectory();
    const metadataPath = join(path, "project.pros");
    await writeFile(metadataPath, "{");

    await expect(inspectProject(path)).rejects.toThrow(
      `invalid project.pros at ${metadataPath}:`,
    );
  });
});

test("creates brain metadata using one-based CLI slots", () => {
  const config = createProgramConfig({
    slot: 8,
    name: "robot",
    description: "competition program",
    icon: "USER902x.bmp",
    type: "pros",
    run: true,
  });

  expect(config.baseName).toBe("slot_8");
  expect(config.program.slot).toBe(7);
  expect(config.autorun).toBe(true);
});

test("does not upload an unrelated binary from the project tree", async () => {
  const path = await temporaryDirectory();
  await mkdir(join(path, "notes"));
  await writeFile(join(path, "notes", "stale.bin"), "stale");
  const project = {
    path,
    type: "vexide" as const,
    name: "robot",
    description: "",
  };

  expect(findProgramArtifact(project)).rejects.toThrow("pass --file");
});

test("stats large artifact candidate sets concurrently and resolves ties deterministically", async () => {
  const root = resolve("/synthetic/target");
  const relativePaths = Array.from(
    { length: 100 },
    (_, index) => `profile-${String(99 - index).padStart(3, "0")}/robot.bin`,
  );
  let active = 0;
  let maximumActive = 0;

  const artifact = await newestNamedBinary(root, "robot", {
    async stat(path) {
      if (path === root) {
        return { isDirectory: () => true, isFile: () => false, mtimeMs: 0 };
      }
      if (path.includes("release")) throw new Error("ENOENT");
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Bun.sleep(1);
      active--;
      const newest =
        path.includes("profile-041") || path.includes("profile-042");
      return {
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: newest ? 2 : 1,
      };
    },
    scan: async function* () {
      for (const path of relativePaths) yield path;
    },
  });

  expect(maximumActive).toBeGreaterThan(1);
  expect(maximumActive).toBeLessThanOrEqual(ARTIFACT_DISCOVERY_CONCURRENCY);
  expect(artifact).toBe(resolve(root, "profile-041/robot.bin"));
});

test("checks conventional Cargo output first and still chooses the newest fallback", async () => {
  const root = resolve("/synthetic/target");
  const conventional = resolve(root, "armv7a-vex-v5/release/robot.bin");
  const fallback = resolve(root, "debug/robot.bin");
  let conventionalChecked = false;

  expect(
    await newestNamedBinary(root, "robot", {
      async stat(path) {
        if (path === conventional) conventionalChecked = true;
        return {
          isDirectory: () => path === root,
          isFile: () => path === conventional || path === fallback,
          mtimeMs: path === fallback ? 20 : path === conventional ? 10 : 0,
        };
      },
      scan: async function* () {
        expect(conventionalChecked).toBe(true);
        yield "debug/robot.bin";
      },
    }),
  ).toBe(fallback);
});

test("finds both halves of a PROS package", async () => {
  const path = await temporaryDirectory();
  await mkdir(join(path, "bin"));
  const hot = join(path, "bin", "hot.package.bin");
  const cold = join(path, "bin", "cold.package.bin");
  await writeFile(hot, "hot");
  await writeFile(cold, "cold");

  const project = {
    path,
    type: "pros" as const,
    name: "robot",
    description: "",
  };

  expect(await findProgramArtifacts(project)).toEqual({ hot, cold });
});

test("rejects an incomplete PROS package", async () => {
  const path = await temporaryDirectory();
  await mkdir(join(path, "bin"));
  await writeFile(join(path, "bin", "hot.package.bin"), "hot");
  const project = {
    path,
    type: "pros" as const,
    name: "robot",
    description: "",
  };

  expect(findProgramArtifacts(project)).rejects.toThrow("cold package");
});

test("rejects empty hot artifacts before reading them", async () => {
  const path = await temporaryDirectory();
  const hot = join(path, "program.bin");
  await writeFile(hot, "");

  await expect(validateProgramArtifacts({ hot })).rejects.toThrow(
    `program hot artifact is empty: ${hot}`,
  );
});

test("rejects oversized hot artifacts with the supported limit", async () => {
  const path = await temporaryDirectory();
  const hot = join(path, "program.bin");
  await writeFile(hot, "x");
  await truncate(hot, PROGRAM_ARTIFACT_SIZE_LIMIT + 1);

  await expect(validateProgramArtifacts({ hot })).rejects.toThrow(
    `program hot artifact ${hot} is ${PROGRAM_ARTIFACT_SIZE_LIMIT + 1} bytes; supported limit is ${PROGRAM_ARTIFACT_SIZE_LIMIT} bytes`,
  );
});

test("rejects empty and oversized PROS cold artifacts", async () => {
  const path = await temporaryDirectory();
  const hot = join(path, "hot.package.bin");
  const cold = join(path, "cold.package.bin");
  await writeFile(hot, "hot");
  await writeFile(cold, "");

  await expect(validateProgramArtifacts({ hot, cold })).rejects.toThrow(
    `program cold artifact is empty: ${cold}`,
  );

  await writeFile(cold, "x");
  await truncate(cold, PROGRAM_ARTIFACT_SIZE_LIMIT + 1);
  await expect(validateProgramArtifacts({ hot, cold })).rejects.toThrow(
    `program cold artifact ${cold} is ${PROGRAM_ARTIFACT_SIZE_LIMIT + 1} bytes; supported limit is ${PROGRAM_ARTIFACT_SIZE_LIMIT} bytes`,
  );
});
