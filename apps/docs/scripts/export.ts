import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { resolveArchiveDestination } from "./archive-path";

const outputDirectory = join(import.meta.dir, "..", ".wrangler", "site");
const archivePath = join(import.meta.dir, "..", ".wrangler", "export.zip");
const siteUrl = "https://docs.v5x.dev";
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
  const destination = resolveArchiveDestination(outputDirectory, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  const file = archive[archivePath];
  if (file === undefined)
    throw new Error(`missing archive entry: ${archivePath}`);

  if (relativePath.endsWith(".html")) {
    const pathname =
      relativePath === "index.html"
        ? "/"
        : `/${relativePath.replace(/\/index\.html$/, "")}`;
    const canonicalUrl = `${siteUrl}${pathname}`;
    const html = new TextDecoder()
      .decode(file)
      .replace(
        "</head>",
        `<link rel="canonical" href="${canonicalUrl}"/><meta property="og:url" content="${canonicalUrl}"/></head>`,
      );
    await writeFile(destination, html);
    continue;
  }

  await writeFile(destination, file);
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

const sitemapPaths = exportedPaths
  .filter(
    (path) =>
      path === "index.html" ||
      (path.endsWith("/index.html") && path !== "index/index.html"),
  )
  .map((path) =>
    path === "index.html" ? "/" : `/${path.replace(/\/index\.html$/, "")}`,
  )
  .sort();
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapPaths.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`),
  "</urlset>",
  "",
].join("\n");

await writeFile(join(outputDirectory, "sitemap.xml"), sitemap);
await writeFile(
  join(outputDirectory, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
);

console.log(`prepared ${paths.length} files for Cloudflare Workers`);
