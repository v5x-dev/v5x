import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { resolveArchiveDestination } from "./archive-path";

const outputDirectory = join(import.meta.dir, "..", ".wrangler", "site");
const archivePath = join(import.meta.dir, "..", ".wrangler", "export.zip");
const faviconIcoPath = join(import.meta.dir, "..", "assets", "favicon.ico");
const siteUrl = "https://docs.v5x.dev";
const excludedFiles = new Set([
  "serve.js",
  "Start Docs.command",
  "Start Docs.bat",
]);

function stripCommonRoot(path: string, commonRoot: string | undefined): string {
  return commonRoot && path.startsWith(`${commonRoot}/`)
    ? path.slice(commonRoot.length + 1)
    : path;
}

function htmlPathname(path: string): string {
  return path === "index.html" ? "/" : `/${path.replace(/\/index\.html$/, "")}`;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
const paths = Object.keys(archive).filter((path) => !path.endsWith("/"));
const rootParts = new Set(paths.map((path) => path.split("/")[0]));
const commonRoot = rootParts.size === 1 ? [...rootParts][0] : undefined;

for (const archivePath of paths) {
  const relativePath = stripCommonRoot(archivePath, commonRoot);

  if (!relativePath || excludedFiles.has(relativePath)) continue;
  const destination = resolveArchiveDestination(outputDirectory, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  const file = archive[archivePath];
  if (file === undefined)
    throw new Error(`missing archive entry: ${archivePath}`);

  if (relativePath.endsWith(".html")) {
    const pathname = htmlPathname(relativePath);
    const canonicalUrl = `${siteUrl}${pathname}`;
    let html = new TextDecoder().decode(file);
    if (relativePath === "index.html") {
      html = html.replace(/<title>.*?<\/title>/, "<title>v5x docs</title>");
    }
    html = html.replace(
      "</head>",
      `<link rel="alternate icon" href="/favicon.ico" sizes="any"/><link rel="canonical" href="${canonicalUrl}"/><meta property="og:url" content="${canonicalUrl}"/></head>`,
    );
    await writeFile(destination, html);
    continue;
  }

  await writeFile(destination, file);
}

const exportedPaths = Object.keys(archive).map((path) =>
  stripCommonRoot(path, commonRoot),
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
  .map((path) => htmlPathname(path))
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

const faviconIco = await readFile(faviconIcoPath);
await mkdir(join(outputDirectory, "assets"), { recursive: true });
await writeFile(join(outputDirectory, "favicon.ico"), faviconIco);
await writeFile(join(outputDirectory, "assets", "favicon.ico"), faviconIco);

console.log(`prepared ${paths.length} files for Cloudflare Workers`);
