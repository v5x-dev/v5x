import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

const outputDirectory = join(import.meta.dir, "..", ".wrangler", "site");
const archivePath = join(import.meta.dir, "..", ".wrangler", "export.zip");
const excludedFiles = new Set([
  "serve.js",
  "Start Docs.command",
  "Start Docs.bat",
]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
const paths = Object.keys(archive).filter((path) => !path.endsWith("/"));
const rootParts = new Set(paths.map((path) => path.split("/")[0]));
const commonRoot = rootParts.size === 1 ? [...rootParts][0] : undefined;

for (const archivePath of paths) {
  const relativePath =
    commonRoot && archivePath.startsWith(`${commonRoot}/`)
      ? archivePath.slice(commonRoot.length + 1)
      : archivePath;

  if (!relativePath || excludedFiles.has(relativePath)) continue;

  const destination = join(outputDirectory, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, archive[archivePath]);
}

const exportedPaths = Object.keys(archive).map((path) =>
  commonRoot && path.startsWith(`${commonRoot}/`)
    ? path.slice(commonRoot.length + 1)
    : path,
);

if (!exportedPaths.includes("index.html")) {
  throw new Error("Mintlify export did not contain index.html");
}

if (!exportedPaths.some((path) => path.startsWith("_next/static/"))) {
  throw new Error("Mintlify export did not contain _next/static assets");
}

console.log(`prepared ${paths.length} files for Cloudflare Workers`);
