import type { Sade } from "sade";
import { withV5Device } from "../device";
import { unwrapSerial } from "../utils/output";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .action(async (file) => {
      await withV5Device(async (device) => {
        unwrapSerial(
          await device.brain.removeFile(file),
          `failed to erase ${file}`,
        );
        console.log(`erased ${file}`);
      });
    });
}
