import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface SourceMap {
  sources: string[];
  sourcesContent: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSourceMap(value: unknown): value is SourceMap {
  if (!isRecord(value)) return false;
  const sources = value.sources;
  const sourcesContent = value.sourcesContent;
  return (
    Array.isArray(sources) &&
    sources.every((source) => typeof source === "string") &&
    Array.isArray(sourcesContent) &&
    sourcesContent.every((source) => typeof source === "string") &&
    sources.length === sourcesContent.length
  );
}

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited with status ${exitCode}`);
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(directory, path)));
    else files.push(path);
  }
  return files;
}

async function verifyMap(path: string): Promise<void> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text());
  if (!isSourceMap(parsed) || parsed.sources.length === 0) {
    throw new Error(`${path} does not embed every referenced source`);
  }
}

async function verifyManifest(
  path: string,
  packageName: string,
): Promise<void> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text());
  if (!isRecord(parsed)) {
    throw new Error(`${packageName} has an invalid package manifest`);
  }

  if (packageName === "serial") {
    const exports = parsed.exports;
    const rootExport = isRecord(exports) ? exports["."] : undefined;
    if (
      parsed.sideEffects !== false ||
      parsed.types !== "./dist/index.d.ts" ||
      !isRecord(rootExport) ||
      rootExport.types !== "./dist/index.d.ts" ||
      rootExport.import !== "./dist/index.js" ||
      rootExport.require !== "./dist/index.cjs"
    ) {
      throw new Error(
        "serial export conditions or declaration metadata are invalid",
      );
    }
  } else {
    const engines = parsed.engines;
    const bin = parsed.bin;
    if (
      parsed.sideEffects !== true ||
      !Array.isArray(parsed.os) ||
      parsed.os.length !== 2 ||
      !["darwin", "linux"].every((os) => parsed.os.includes(os)) ||
      !isRecord(engines) ||
      typeof engines.bun !== "string" ||
      !isRecord(bin) ||
      bin.v5x !== "./dist/index.js"
    ) {
      throw new Error(
        "CLI platform, runtime, or executable metadata are invalid",
      );
    }
  }
}

async function verifyArchive(archive: string): Promise<void> {
  const archiveName = basename(archive);
  const packageName = archiveName.includes("serial") ? "serial" : "cli";
  const directory = await mkdtemp(join(tmpdir(), `v5x-${packageName}-`));

  try {
    await run(["tar", "-xzf", resolve(archive), "-C", directory]);
    const packageRoot = join(directory, "package");
    const files = await listFiles(packageRoot);
    await verifyManifest(join(packageRoot, "package.json"), packageName);
    const allowedRoots = new Set(["LICENSE", "README.md", "package.json"]);
    const unexpected = files.filter(
      (file) => !file.startsWith("dist/") && !allowedRoots.has(file),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `${archiveName} contains unexpected files: ${unexpected.join(", ")}`,
      );
    }
    if (
      files.some((file) =>
        /(^|\/)(?:src|test|tests|\.cache|staging)(\/|$)|\.test\./.test(file),
      )
    ) {
      throw new Error(
        `${archiveName} contains source, test, cache, or staging files`,
      );
    }

    const maps =
      packageName === "serial"
        ? ["dist/index.js.map", "dist/index.cjs.map"]
        : ["dist/index.js.map"];
    for (const map of maps) await verifyMap(join(packageRoot, map));

    if (packageName === "serial") {
      for (const required of [
        "dist/index.js",
        "dist/index.cjs",
        "dist/index.d.ts",
      ]) {
        if (!files.includes(required))
          throw new Error(`${archiveName} is missing ${required}`);
      }
    } else {
      const mode = (await stat(join(packageRoot, "dist/index.js"))).mode;
      if ((mode & 0o111) === 0)
        throw new Error(`${archiveName} CLI binary is not executable`);
    }

    const archiveSize = (await stat(archive)).size;
    if (archiveSize > 2_000_000) {
      throw new Error(`${archiveName} exceeds the 2 MB packed-size budget`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const archives = process.argv.slice(2);
if (archives.length !== 2) {
  throw new Error("Pass the @v5x/serial and @v5x/cli tarballs to this script");
}
for (const archive of archives) await verifyArchive(archive);
