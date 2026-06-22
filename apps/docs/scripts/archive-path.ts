import { isAbsolute, relative, resolve } from "node:path";

export function resolveArchiveDestination(
  outputDirectory: string,
  archivePath: string,
): string {
  if (isAbsolute(archivePath) || archivePath.split(/[\\/]/).includes("..")) {
    throw new Error(`export contains an unsafe path: ${archivePath}`);
  }

  const destination = resolve(outputDirectory, archivePath);
  if (relative(outputDirectory, destination).startsWith("..")) {
    throw new Error(`export path escapes output directory: ${archivePath}`);
  }
  return destination;
}
