import type { Sade } from "sade";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { printJson, unwrapSerial } from "../utils/output";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .option("--json", "print machine-readable JSON")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(
      async (file, options: { json?: boolean } & PortSelectionOptions) => {
        const handle = parseBrainFilePath(file);
        await withSelectedV5Device(options, async (device) => {
          unwrapSerial(
            await device.brain.removeFile(handle),
            `failed to erase ${file}`,
          );
          if (options.json === true)
            printJson({ command: "rm", file, erased: true });
          else console.log(`erased ${file}`);
        });
      },
    );
}
