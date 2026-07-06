import type { Sade } from "sade";
import { withV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { unwrapSerial } from "../utils/output";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .action(async (file) => {
      const handle = parseBrainFilePath(file);
      await withV5Device(async (device) => {
        unwrapSerial(
          await device.brain.removeFile(handle),
          `failed to erase ${file}`,
        );
        console.log(`erased ${file}`);
      });
    });
}
