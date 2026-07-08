import type { Sade } from "sade";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { unwrapSerial } from "../utils/output";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(async (file, options: PortSelectionOptions) => {
      const handle = parseBrainFilePath(file);
      await withSelectedV5Device(options, async (device) => {
        unwrapSerial(
          await device.brain.removeFile(handle),
          `failed to erase ${file}`,
        );
        console.log(`erased ${file}`);
      });
    });
}
