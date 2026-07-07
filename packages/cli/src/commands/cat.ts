import type { Sade } from "sade";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { unwrapSerial } from "../utils/output";

/**
 * Heuristically detects whether a byte buffer is binary rather than text, by
 * scanning a sample for NUL bytes and other control characters that never
 * appear in plain text files.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const sampleSize = Math.min(bytes.length, 8000);
  for (const byte of bytes.subarray(0, sampleSize)) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) return true;
  }
  return false;
}

export default function registerCatCommand(program: Sade) {
  program
    .command("cat <file>", "read a file from flash")
    .option(
      "-o, --output",
      "write the file contents to a path instead of stdout",
    )
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(
      async (
        file: string,
        options: { output?: string } & PortSelectionOptions,
      ) => {
        const handle = parseBrainFilePath(file);
        await withSelectedV5Device(options, async (device) => {
          const bytes = unwrapSerial(
            await device.brain.readFile(handle),
            `failed to read ${file}`,
          );

          if (options.output !== undefined) {
            await Bun.write(options.output, bytes);
            console.log(`wrote ${options.output}`);
            return;
          }

          if (!process.stdout.isTTY) {
            process.stdout.write(bytes);
            return;
          }

          if (looksBinary(bytes)) {
            throw new Error(
              `refusing to write binary contents of ${file} to a terminal; use --output <file> or redirect stdout`,
            );
          }

          console.log(new TextDecoder().decode(bytes));
        });
      },
    );
}
