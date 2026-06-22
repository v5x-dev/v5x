import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectProgramType } from "./detect";
import {
  createProgramConfig,
  findProgramArtifact,
  findProgramArtifacts,
  inspectProject,
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
