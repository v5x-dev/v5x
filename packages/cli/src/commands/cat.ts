import type { Sade } from "sade";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { requireOptionValue } from "../utils/guards";
import { printJson, unwrapSerial } from "../utils/output";

export function decodeCatText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function formatCatText(bytes: Uint8Array): string {
  const text = decodeCatText(bytes);
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function toCatJson(file: string, bytes: Uint8Array, output?: string) {
  return {
    command: "cat",
    file,
    bytes: bytes.length,
    ...(output === undefined
      ? { encoding: "base64", data: Buffer.from(bytes).toString("base64") }
      : { output }),
  };
}

export default function registerCatCommand(program: Sade) {
  program
    .command("cat <file>", "read a file from flash")
    .option("-o, --output", "write the file bytes to a local path")
    .option("--json", "print machine-readable JSON")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(
      async (
        file,
        options: {
          output?: string | boolean;
          json?: boolean;
        } & PortSelectionOptions,
      ) => {
        const output = requireOptionValue(options.output, "--output");
        const handle = parseBrainFilePath(file);
        await withSelectedV5Device(options, async (device) => {
          const bytes = unwrapSerial(
            await device.brain.readFile(handle),
            `failed to read ${file}`,
          );
          if (output !== undefined) {
            await Bun.write(output, bytes);
            if (options.json === true)
              printJson(toCatJson(file, bytes, output));
            return;
          }

          if (options.json === true) {
            printJson(toCatJson(file, bytes));
            return;
          }

          if (process.stdout.isTTY === true)
            process.stdout.write(formatCatText(bytes));
          else process.stdout.write(bytes);
        });
      },
    );
}
