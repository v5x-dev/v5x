import type { Sade } from "sade";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { unwrapSerial } from "../utils/output";

export function decodeCatText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function formatCatText(bytes: Uint8Array): string {
  const text = decodeCatText(bytes);
  return text.endsWith("\n") ? text : `${text}\n`;
}

export default function registerCatCommand(program: Sade) {
  program
    .command("cat <file>", "read a file from flash")
    .option("-o, --output", "write the file bytes to a local path")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(
      async (file, options: { output?: string } & PortSelectionOptions) => {
        const handle = parseBrainFilePath(file);
        await withSelectedV5Device(options, async (device) => {
          const bytes = unwrapSerial(
            await device.brain.readFile(handle),
            `failed to read ${file}`,
          );
          if (options.output !== undefined) {
            await Bun.write(options.output, bytes);
            return;
          }

          if (process.stdout.isTTY === true)
            process.stdout.write(formatCatText(bytes));
          else process.stdout.write(bytes);
        });
      },
    );
}
