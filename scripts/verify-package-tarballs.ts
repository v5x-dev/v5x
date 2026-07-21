import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

type PackageName = "@v5x/serial" | "@v5x/cli" | "@v5x/web" | "@v5x/events";

interface SourceMap {
  sources: string[];
  sourcesContent: string[];
}

interface PackageIdentity {
  name: PackageName;
  manifest: Record<string, unknown>;
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

function isPackageName(value: unknown): value is PackageName {
  return (
    value === "@v5x/serial" ||
    value === "@v5x/cli" ||
    value === "@v5x/web" ||
    value === "@v5x/events"
  );
}

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited with status ${exitCode}`);
  }
}

async function verifyNpmInstall(archives: string[]): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "v5x-npm-install-"));

  try {
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({ name: "v5x-tarball-smoke", private: true }),
    );
    await run([
      "npm",
      "install",
      "--ignore-scripts",
      "--no-package-lock",
      "--prefix",
      directory,
      ...archives.map((archive) => resolve(archive)),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
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

async function readPackageIdentity(path: string): Promise<PackageIdentity> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text());
  if (!isRecord(parsed)) {
    throw new Error(`${path} is not a valid package manifest`);
  }

  if (!isPackageName(parsed.name)) {
    throw new Error(`${path} has an unsupported package name`);
  }

  return { name: parsed.name, manifest: parsed };
}

function verifyExport(
  manifest: Record<string, unknown>,
  packageName: PackageName,
  subpath: string,
  types: string,
  importPath: string,
  requirePath?: string,
): void {
  const exports = manifest.exports;
  const subpathExport = isRecord(exports) ? exports[subpath] : undefined;
  if (
    !isRecord(subpathExport) ||
    subpathExport.types !== types ||
    subpathExport.import !== importPath ||
    (requirePath !== undefined && subpathExport.require !== requirePath)
  ) {
    throw new Error(`${packageName} ${subpath} export metadata is invalid`);
  }
}

export function verifyManifest(
  packageName: PackageName,
  parsed: Record<string, unknown>,
  expectedSerialVersion?: string,
): void {
  if (packageName === "@v5x/serial") {
    const exports = parsed.exports;
    const rootExport = isRecord(exports) ? exports["."] : undefined;
    if (
      parsed.name !== "@v5x/serial" ||
      parsed.sideEffects !== true ||
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
  } else if (packageName === "@v5x/cli") {
    const engines = parsed.engines;
    const bin = parsed.bin;
    if (
      parsed.name !== "@v5x/cli" ||
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
  } else if (packageName === "@v5x/web") {
    if (
      parsed.name !== "@v5x/web" ||
      parsed.type !== "module" ||
      parsed.main !== "./dist/index.js" ||
      parsed.module !== "./dist/index.js" ||
      parsed.types !== "./dist/index.d.ts" ||
      parsed.sideEffects !== false
    ) {
      throw new Error("web package metadata is invalid");
    }

    verifyExport(
      parsed,
      packageName,
      ".",
      "./dist/index.d.ts",
      "./dist/index.js",
    );
    verifyExport(
      parsed,
      packageName,
      "./testing",
      "./dist/testing.d.ts",
      "./dist/testing.js",
    );
    verifyExport(
      parsed,
      packageName,
      "./react",
      "./dist/react/index.d.ts",
      "./dist/react/index.js",
    );
    verifyExport(
      parsed,
      packageName,
      "./svelte",
      "./dist/svelte/index.d.ts",
      "./dist/svelte/index.js",
    );
    verifyExport(
      parsed,
      packageName,
      "./solid",
      "./dist/solid/index.d.ts",
      "./dist/solid/index.js",
    );
  } else {
    if (
      parsed.name !== "@v5x/events" ||
      parsed.type !== "module" ||
      parsed.main !== "./dist/index.js" ||
      parsed.module !== "./dist/index.js" ||
      parsed.types !== "./dist/index.d.ts" ||
      parsed.sideEffects !== false
    ) {
      throw new Error("events package metadata is invalid");
    }

    verifyExport(
      parsed,
      packageName,
      ".",
      "./dist/index.d.ts",
      "./dist/index.js",
    );
  }

  if (packageName === "@v5x/cli" || packageName === "@v5x/web") {
    const dependencies = parsed.dependencies;
    const serialVersion = isRecord(dependencies)
      ? dependencies["@v5x/serial"]
      : undefined;
    if (
      typeof serialVersion !== "string" ||
      serialVersion.startsWith("workspace:") ||
      (expectedSerialVersion !== undefined &&
        serialVersion !== expectedSerialVersion)
    ) {
      throw new Error(
        `${packageName} must depend on @v5x/serial at the expected released version`,
      );
    }
  }
}

export async function verifyArchive(
  archive: string,
  expectedSerialVersion?: string,
): Promise<PackageName> {
  const archiveName = basename(archive);
  const directory = await mkdtemp(join(tmpdir(), "v5x-package-"));

  try {
    await run(["tar", "-xzf", resolve(archive), "-C", directory]);
    const packageRoot = join(directory, "package");
    const files = await listFiles(packageRoot);
    const { name: packageName, manifest } = await readPackageIdentity(
      join(packageRoot, "package.json"),
    );
    verifyManifest(packageName, manifest, expectedSerialVersion);
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

    const maps = getRequiredMaps(packageName);
    for (const map of maps) await verifyMap(join(packageRoot, map));

    for (const required of getRequiredFiles(packageName)) {
      if (!files.includes(required)) {
        throw new Error(`${archiveName} is missing ${required}`);
      }
    }

    if (packageName === "@v5x/cli") {
      const mode = (await stat(join(packageRoot, "dist/index.js"))).mode;
      if ((mode & 0o111) === 0)
        throw new Error(`${archiveName} CLI binary is not executable`);
    }

    const archiveSize = (await stat(archive)).size;
    const sizeBudget = getPackedSizeBudget(packageName);
    if (archiveSize > sizeBudget.bytes) {
      throw new Error(
        `${archiveName} exceeds the ${sizeBudget.label} packed-size budget`,
      );
    }

    return packageName;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function getRequiredFiles(packageName: PackageName): string[] {
  if (packageName === "@v5x/serial") {
    return ["dist/index.js", "dist/index.cjs", "dist/index.d.ts"];
  }

  if (packageName === "@v5x/cli") {
    return ["dist/index.js"];
  }

  if (packageName === "@v5x/events") {
    return [
      "dist/client.d.ts",
      "dist/errors.d.ts",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/types.d.ts",
    ];
  }

  return [
    "dist/client.d.ts",
    "dist/errors.d.ts",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/react/index.js",
    "dist/react/index.d.ts",
    "dist/react/provider.d.ts",
    "dist/react/use-v5-connection.d.ts",
    "dist/react/use-v5-snapshot.d.ts",
    "dist/svelte/index.js",
    "dist/svelte/index.d.ts",
    "dist/svelte/state.d.ts",
    "dist/solid/index.js",
    "dist/solid/index.d.ts",
    "dist/solid/create-v5-connection.d.ts",
    "dist/solid/create-v5-snapshot.d.ts",
    "dist/solid/provider.d.ts",
    "dist/store.d.ts",
    "dist/support.d.ts",
    "dist/testing.js",
    "dist/testing.d.ts",
    "dist/testing.js.map",
  ];
}

function getRequiredMaps(packageName: PackageName): string[] {
  if (packageName === "@v5x/serial") {
    return ["dist/index.js.map", "dist/index.cjs.map"];
  }

  if (packageName === "@v5x/cli") {
    return ["dist/index.js.map"];
  }

  if (packageName === "@v5x/events") {
    return ["dist/index.js.map"];
  }

  return [
    "dist/index.js.map",
    "dist/testing.js.map",
    "dist/react/index.js.map",
    "dist/svelte/index.js.map",
    "dist/solid/index.js.map",
  ];
}

function getPackedSizeBudget(packageName: PackageName): {
  bytes: number;
  label: string;
} {
  if (packageName === "@v5x/web" || packageName === "@v5x/events") {
    return { bytes: 1_000_000, label: "1 MB" };
  }

  return { bytes: 2_000_000, label: "2 MB" };
}

function parseArguments(args: string[]): {
  archives: string[];
  expectedSerialVersion?: string;
} {
  const [first, second, ...archives] = args;
  if (first !== "--serial-version") return { archives: args };
  if (second === undefined || second.startsWith("-")) {
    throw new Error("--serial-version requires a concrete version");
  }

  return { archives, expectedSerialVersion: second };
}

if (import.meta.main) {
  const { archives, expectedSerialVersion } = parseArguments(
    process.argv.slice(2),
  );
  if (archives.length === 0) {
    throw new Error(
      "Pass one or more @v5x/serial, @v5x/cli, @v5x/web, or @v5x/events tarballs to this script",
    );
  }
  const verifiedPackages = new Set<PackageName>();
  for (const archive of archives) {
    const packageName = await verifyArchive(archive, expectedSerialVersion);
    if (verifiedPackages.has(packageName)) {
      throw new Error(`Received duplicate tarball for ${packageName}`);
    }
    verifiedPackages.add(packageName);
  }
  await verifyNpmInstall(archives);
}
